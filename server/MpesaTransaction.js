const mongoose = require('mongoose');

const MpesaTransactionSchema = new mongoose.Schema({
  merchantRequestID: { type: String, required: true },
  checkoutRequestID: { type: String, required: true, unique: true },
  resultCode: { type: Number },
  resultDesc: { type: String },
  amount: { type: Number, required: true },
  mpesaReceiptNumber: { type: String },
  transactionDate: { type: Date },
  phoneNumber: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'], 
    default: 'PENDING' 
  },
  householdId: { type: String }, // Link to your household data
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MpesaTransaction', MpesaTransactionSchema);