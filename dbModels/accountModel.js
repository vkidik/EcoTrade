const mongoose = require('mongoose');

const accountSchema = mongoose.model('Account', {
    tgId: Number,
    mexcKey: String,
    mexcSecretKey: String,
    subscribtion: {
        type: Object,
        enum: [
            {
                active: false
            },
            {
                active: true,
                ts: Number,
            }
        ], 
    }
}, { versionKey: false });

const Account = mongoose.model('Account', accountSchema, 'accounts');

module.exports = Account;