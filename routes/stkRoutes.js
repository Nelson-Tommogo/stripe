// src/routes/stkRoutes.js

import express from 'express';
import axios from 'axios';
import moment from 'moment';
import Transaction from '../models/Transaction.js';
import { getToken } from '../middlewares/tokenMiddleware.js';

const router = express.Router();

// Route to test token generation
router.get('/token', getToken, (req, res) => {
    res.status(200).json({
        message: 'Token generated successfully',
        token: req.token,
    });
});

// Route to handle STK push request via Till Number
router.post('/stkpush', getToken, async (req, res) => {
    try {
        const token = req.token;
        let { phoneNumber, amount } = req.body;

        if (!phoneNumber || !amount) {
            return res.status(400).json({ error: 'Phone number and amount are required fields.' });
        }

        if (phoneNumber.startsWith('07') && phoneNumber.length === 10) {
            phoneNumber = '254' + phoneNumber.substring(1);
        } else if (phoneNumber.length !== 12 || !phoneNumber.startsWith('254')) {
            return res.status(400).json({ error: 'Invalid phone number format.' });
        }

        const timestamp = moment().format('YYYYMMDDHHmmss');
        const tillNumber = process.env.M_PESA_SHORT_CODE;
        const passKey = process.env.M_PESA_PASSKEY;
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
            AccountReference: 'BuyGoods',
            TransactionDesc: 'Payment via Till Number',
        };

        const response = await axios.post(
            process.env.MPESA_API_URLS_STK_PUSH,
            requestBody,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        if (response.data.ResponseCode === '0') {
            return res.status(200).json({
                message: 'Payment has been initiated. Check your phone to proceed.',
                checkoutRequestID: response.data.CheckoutRequestID,
                merchantRequestID: response.data.MerchantRequestID,
                responseDescription: response.data.ResponseDescription,
            });
        } else {
            return res.status(400).json({
                error: 'Failed to initiate your payment request.',
                responseDescription: response.data.ResponseDescription,
            });
        }
    } catch (error) {
        console.error('Error during STK push:', error.message);
        if (error.response) {
            return res.status(error.response.status).json({
                error: 'Safaricom API Error',
                message: error.response.data,
            });
        }
        return res.status(500).json({
            error: 'Internal Server Error',
            message: error.message,
        });
    }
});

// Handle STK Callback from Safaricom
router.post('/callback', async (req, res) => {
    try {
        const callbackData = req.body;
        console.log('📥 Received STK Callback:', JSON.stringify(callbackData, null, 2));

        const stkCallback = callbackData?.Body?.stkCallback;
        if (!stkCallback) {
            return res.status(400).json({ error: 'Invalid callback structure' });
        }

        const {
            MerchantRequestID: merchantRequestID,
            CheckoutRequestID: checkoutRequestID,
            ResultCode: resultCode,
            ResultDesc: resultDesc,
            CallbackMetadata: metadata
        } = stkCallback;

        const transactionUpdate = {
            merchantRequestID,
            checkoutRequestID,
            resultCode,
            resultDesc,
            status: resultCode === 0 ? 'completed' : 'failed',
            callbackReceivedAt: new Date(),
            rawCallback: callbackData
        };

        if (resultCode === 0 && metadata) {
            const extract = (name) =>
                metadata.Item.find((i) => i.Name === name)?.Value;

            transactionUpdate.mpesaReceiptNumber = extract('MpesaReceiptNumber');
            transactionUpdate.amount = extract('Amount');
            transactionUpdate.phoneNumber = extract('PhoneNumber');
            transactionUpdate.transactionDate = new Date();
        }

        const transaction = await Transaction.findOneAndUpdate(
            { checkoutRequestID },
            { $set: transactionUpdate },
            { new: true, upsert: true }
        );

        res.status(200).json({
            message: '✅ Callback processed successfully',
            status: transaction.status,
            transaction,
        });
    } catch (error) {
        console.error('❌ Callback Error:', error.message);
        res.status(500).json({ error: 'Failed to process callback', details: error.message });
    }
});

// Query STK Push Status
router.post('/stkquery', getToken, async (req, res) => {
    try {
        const { checkoutRequestID } = req.body;
        if (!checkoutRequestID) {
            return res.status(400).json({ error: "CheckoutRequestID is required" });
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
                },
            }
        );

        const { ResultCode, ResultDesc } = response.data;
        
        const transaction = await Transaction.findOne({ checkoutRequestID });

        if (!transaction) {
            return res.status(404).json({
                error: "Transaction not found for the given CheckoutRequestID.",
            });
        }

        let status = "failed";
        if (ResultCode === "0") {
            status = "completed";
        }

        transaction.status = status;
        transaction.resultCode = ResultCode;
        transaction.resultDesc = ResultDesc;
        transaction.transactionDate = moment().toDate();

        await transaction.save();

        return res.status(200).json({
            status: "Success",
            message: `Payment status: ${status}`,
            transaction: transaction,
            response: response.data,
        });
    } catch (error) {
        return res.status(500).json({
            error: "An error occurred while querying the STK payment status.",
            details: error.response?.data || error.message,
        });
    }
});

export default router;
