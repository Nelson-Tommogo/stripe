export const validatePhoneNumber = (req, res, next) => {
    let { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ 
            success: false,
            error: 'Phone number is required' 
        });
    }

    // Convert to string in case it's a number
    phoneNumber = phoneNumber.toString().trim();

    // Convert formats:
    // 07... => 2547...
    // 7... => 2547...
    // +254... => 254...
    if (phoneNumber.startsWith('0') && phoneNumber.length === 10) {
        phoneNumber = '254' + phoneNumber.substring(1);
    } else if (phoneNumber.startsWith('7') && phoneNumber.length === 9) {
        phoneNumber = '254' + phoneNumber;
    } else if (phoneNumber.startsWith('+254')) {
        phoneNumber = phoneNumber.substring(1);
    }

    // Final validation
    if (phoneNumber.length !== 12 || !phoneNumber.startsWith('254') || !/^\d+$/.test(phoneNumber)) {
        return res.status(400).json({ 
            success: false,
            error: 'Invalid phone number format. Use format: 2547XXXXXXXX' 
        });
    }

    req.body.phoneNumber = phoneNumber;
    next();
};

export const validateAmount = (req, res, next) => {
    const { amount } = req.body;
    
    if (amount === undefined || amount === null) {
        return res.status(400).json({ 
            success: false,
            error: 'Amount is required' 
        });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) {
        return res.status(400).json({ 
            success: false,
            error: 'Amount must be a valid number' 
        });
    }

    if (amountNum < 1) {
        return res.status(400).json({ 
            success: false,
            error: 'Amount must be at least KES 1' 
        });
    }

    if (amountNum > 150000) {
        return res.status(400).json({ 
            success: false,
            error: 'Amount cannot exceed KES 150,000' 
        });
    }

    req.body.amount = Math.round(amountNum); // Ensure whole number
    next();
};