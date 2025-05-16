import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  amount: { type: Number, required: true },
  accountReference: String,
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed'], 
    default: 'pending' 
  },
  merchantRequestID: String,
  checkoutRequestID: String,
  mpesaReceiptNumber: String,
  resultCode: Number,
  resultDesc: String,
  transactionDate: Date,
  callbackReceivedAt: Date,
  rawCallback: {
    type: Object,
    select: false
  }
}, { 
  timestamps: true
});

export default mongoose.model('Transaction', transactionSchema);
