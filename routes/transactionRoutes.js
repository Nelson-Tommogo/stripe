import express from 'express';
import Transaction from '../models/Transaction.js';

const router = express.Router();

// ✅ Get all transactions
router.get('/all', async (req, res) => {
    try {
        const transactions = await Transaction.find().sort({ createdAt: -1 });
        res.status(200).json({ transactions });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// ✅ Get transaction by ID
router.get('/get/:id', async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id);
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        res.status(200).json({ transaction });
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({ error: 'Error fetching transaction' });
    }
});

// ✅ Get transactions by phone number
router.get('/by-phone/:phoneNumber', async (req, res) => {
    try {
        const transactions = await Transaction.find({
            phoneNumber: req.params.phoneNumber
        }).sort({ createdAt: -1 });

        if (transactions.length === 0) {
            return res.status(404).json({ error: 'No transactions found for this phone number' });
        }

        res.status(200).json({ transactions });
    } catch (error) {
        console.error('Error fetching transactions by phone number:', error);
        res.status(500).json({ error: 'Error fetching transactions by phone number' });
    }
});

// ✅ Manually create a new transaction (admin/testing only)
router.post('/create', async (req, res) => {
    try {
        // Ensure that the necessary fields are provided
        const { phoneNumber, amount } = req.body;
        if (!phoneNumber || !amount) {
            return res.status(400).json({ error: 'Phone number and amount are required' });
        }

        const transaction = new Transaction(req.body);
        await transaction.save();
        res.status(201).json({ message: 'Transaction created successfully', transaction });
    } catch (error) {
        console.error('Error creating transaction:', error);
        res.status(500).json({ error: 'Failed to create transaction' });
    }
});

// ✅ Update transaction status (useful for admin updates)
router.patch('/update/:id', async (req, res) => {
    try {
        const transaction = await Transaction.findByIdAndUpdate(
            req.params.id,
            req.body, 
            { new: true } // Returns the updated document
        );

        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        res.status(200).json({ message: 'Transaction updated successfully', transaction });
    } catch (error) {
        console.error('Error updating transaction:', error);
        res.status(500).json({ error: 'Failed to update transaction' });
    }
});

// ✅ Delete a transaction (admin/testing only)
router.delete('/delete/:id', async (req, res) => {
    try {
        const transaction = await Transaction.findByIdAndDelete(req.params.id);

        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        res.status(200).json({ message: 'Transaction deleted successfully' });
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.status(500).json({ error: 'Failed to delete transaction' });
    }
});

export default router;
