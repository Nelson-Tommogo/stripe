import express from 'express';
import axios from 'axios';
import moment from 'moment';
import Transaction from '../models/Transaction.js';
import { getToken } from '../middlewares/tokenMiddleware.js';
import { validatePhoneNumber, validateAmount } from '../middlewares/validationMiddleware.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting to prevent abuse
const stkPushLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many STK push requests from this IP, please try again later'
});

// Route to test token generation
router.get('/token', getToken, (req, res) => {
    try {
        if (!req.token) {
            throw new Error('Token generation failed');
        }
        res.status(200).json({
            success: true,
            message: 'Token generated successfully',
            token: req.token,
        });
    } catch (error) {
        console.error('Token generation error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during token generation'
        });
    }
});

// Route to handle STK push request via Till Number
router.post('/stkpush', getToken, validatePhoneNumber, validateAmount, stkPushLimiter, async (req, res) => {
    try {
        const token = req.token;
        let { phoneNumber, amount, reference } = req.body;

        // Additional validation
        if (isNaN(amount)) {
            return res.status(400).json({ 
                success: false,
                error: 'Amount must be a valid number' 
            });
        }});
        

        amount = Math.round(amount); // Safaricom requires whole numbers

        if (amount < 10 || amount > 70000) {
            return res.status(400).json({ 
                success: false,
                error: 'Amount must be between KES 10 and KES 70,000' 
            });
        }

        const timestamp = moment().format('YYYYMMDDHHmmss');
        const tillNumber = process.env.M_PESA_SHORT_CODE;
        const passKey = process.env.M_PESA_PASSKEY;
        
        if (!tillNumber || !passKey) {
            throw new Error('M-Pesa credentials not configured');
        }

        const password = Buffer.from(`${tillNumber}${passKey}${timestamp}`).toString('base64');

        const requestBody = {
            BusinessShortCode: tillNumber,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerBuyGoodsOnline',
            Amount: amount,
            PartyA: phoneNumber,
            PartyB: tillNumber,
            PhoneNumber: phoneNumber,
            CallBackURL: process.env.CALLBACK_URL,
            AccountReference: reference || 'BuyGoods',
            TransactionDesc: 'Payment via Till Number',
        };

        // Log the request (without sensitive data)
        console.log(`Initiating STK push for ${phoneNumber}, amount: ${amount}`);

        const response = await axios.post(
            process.env.MPESA_API_URLS_STK_PUSH,
            requestBody,
            { 
                headers: { 
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 seconds timeout
            }
        );

        if (!response.data || !response.data.ResponseCode) {
            throw new Error('Invalid response from M-Pesa API');
        }

        if (response.data.ResponseCode === '0') {
            // Save transaction to database
            const transaction = new Transaction({
                phoneNumber,
                amount,
                merchantRequestID: response.data.MerchantRequestID,
                checkoutRequestID: response.data.CheckoutRequestID,
                status: 'pending',
                initiatedAt: new Date(),
                accountReference: requestBody.AccountReference
            });
            await transaction.save();

            return res.status(200).json({
                success: true,
                message: 'Payment has been initiated. Check your phone to proceed.',
                checkoutRequestID: response.data.CheckoutRequestID,
                merchantRequestID: response.data.MerchantRequestID,
                responseDescription: response.data.ResponseDescription,
                transactionId: transaction._id
            });
        } else {
            return res.status(400).json({
                success: false,
                error: 'Failed to initiate payment request',
                responseCode: response.data.ResponseCode,
                responseDescription: response.data.ResponseDescription,
            });
        }
    } catch (error) {
        console.error('STK push error:', error.message);
        
        // Specific error handling
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                success: false,
                error: 'Request to M-Pesa API timed out',
                message: 'Please try again later'
            });
        }
        
        if (error.response) {
            // Handle different M-Pesa error codes
            const mpesaError = error.response.data;
            let statusCode = 400;
            let errorMessage = 'M-Pesa API Error';
            
            if (mpesaError.errorCode === '400.002.02') {
                errorMessage = 'Invalid phone number format';
            } else if (mpesaError.errorCode === '400.002.01') {
                errorMessage = 'Invalid amount';
            } else if (mpesaError.errorCode === '500.001.1001') {
                statusCode = 503;
                errorMessage = 'M-Pesa service unavailable';
            }
            
            return res.status(statusCode).json({
                success: false,
                error: errorMessage,
                details: mpesaError
            });
        }
        
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: error.message,
        });
    }
});

// Handle STK Callback from Safaricom
router.post('/callback', async (req, res) => {
    try {
        const callbackData = req.body;
        
        if (!callbackData) {
            return res.status(400).json({ 
                success: false,
                error: 'Empty callback received' 
            });
        }

        console.log('📥 Received STK Callback:', JSON.stringify(callbackData, null, 2));

        const stkCallback = callbackData?.Body?.stkCallback;
        if (!stkCallback) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid callback structure' 
            });
        }

        const {
            MerchantRequestID: merchantRequestID,
            CheckoutRequestID: checkoutRequestID,
            ResultCode: resultCode,
            ResultDesc: resultDesc,
            CallbackMetadata: metadata
        } = stkCallback;

        // Validate required fields
        if (!merchantRequestID || !checkoutRequestID || resultCode === undefined) {
            return res.status(400).json({ 
                success: false,
                error: 'Missing required callback fields' 
            });
        }

        const transactionUpdate = {
            merchantRequestID,
            checkoutRequestID,
            resultCode,
            resultDesc,
            status: resultCode == 0 ? 'completed' : 'failed',
            callbackReceivedAt: new Date(),
            rawCallback: callbackData
        };

        if (resultCode == 0 && metadata && metadata.Item) {
            const extract = (name) => {
                const item = metadata.Item.find((i) => i.Name === name);
                return item ? item.Value : null;
            };

            transactionUpdate.mpesaReceiptNumber = extract('MpesaReceiptNumber');
            transactionUpdate.amount = extract('Amount');
            transactionUpdate.phoneNumber = extract('PhoneNumber');
            transactionUpdate.transactionDate = new Date(extract('TransactionDate'));
        }

        // Find and update transaction
        const transaction = await Transaction.findOneAndUpdate(
            { checkoutRequestID },
            { $set: transactionUpdate },
            { new: true, upsert: false }
        );

        if (!transaction) {
            console.warn(`Transaction not found for CheckoutRequestID: ${checkoutRequestID}`);
            return res.status(404).json({ 
                success: false,
                error: 'Transaction not found' 
            });
        }

        res.status(200).json({
            success: true,
            message: 'Callback processed successfully',
            status: transaction.status,
            transactionId: transaction._id,
        });
    } catch (error) {
        console.error('❌ Callback processing error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Failed to process callback', 
            details: error.message 
        });
    }
});

// Query STK Push Status
router.post('/stkquery', getToken, async (req, res) => {
    try {
        const { checkoutRequestID } = req.body;
        
        if (!checkoutRequestID) {
            return res.status(400).json({ 
                success: false,
                error: "CheckoutRequestID is required" 
            });
        }

        // Validate checkoutRequestID format
        if (typeof checkoutRequestID !== 'string' || checkoutRequestID.length < 10) {
            return res.status(400).json({ 
                success: false,
                error: "Invalid CheckoutRequestID format" 
            });
        }

        const timestamp = moment().format("YYYYMMDDHHmmss");
        const password = Buffer.from(
            `${process.env.M_PESA_SHORT_CODE}${process.env.M_PESA_PASSKEY}${timestamp}`
        ).toString("base64");

        const requestBody = {
            BusinessShortCode: process.env.M_PESA_SHORT_CODE,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestID,
        };

        const response = await axios.post(
            `${process.env.BASE_URL}/mpesa/stkpushquery/v1/query`,
            requestBody,
            {
                headers: {
                    Authorization: `Bearer ${req.token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        if (!response.data || response.data.ResultCode === undefined) {
            throw new Error('Invalid response from M-Pesa API');
        }

        const { ResultCode, ResultDesc } = response.data;
        
        const transaction = await Transaction.findOne({ checkoutRequestID });

        if (!transaction) {
            return res.status(404).json({
                success: false,
                error: "Transaction not found",
            });
        }

        let status = "failed";
        if (ResultCode == "0") {
            status = "completed";
        }

        // Update transaction status
        transaction.status = status;
        transaction.resultCode = ResultCode;
        transaction.resultDesc = ResultDesc;
        transaction.lastCheckedAt = new Date();
        
        if (status === 'completed' && !transaction.transactionDate) {
            transaction.transactionDate = new Date();
        }

        await transaction.save();

        return res.status(200).json({
            success: true,
            status: status,
            message: ResultDesc,
            transaction: {
                id: transaction._id,
                amount: transaction.amount,
                phoneNumber: transaction.phoneNumber,
                status: transaction.status,
                receiptNumber: transaction.mpesaReceiptNumber,
                transactionDate: transaction.transactionDate
            },
        });
    } catch (error) {
        console.error('STK query error:', error.message);
        
        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                error: "M-Pesa API Error",
                details: error.response.data,
            });
        }
        
        return res.status(500).json({
            success: false,
            error: "Internal server error",
            details: error.message,
        });
    }
});

export default router;