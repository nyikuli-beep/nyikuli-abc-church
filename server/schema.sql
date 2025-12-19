CREATE TABLE mpesa_transactions (
    id SERIAL PRIMARY KEY,
    merchant_request_id VARCHAR(255) NOT NULL,
    checkout_request_id VARCHAR(255) NOT NULL UNIQUE,
    result_code INT,
    result_desc TEXT,
    amount DECIMAL(10, 2) NOT NULL,
    mpesa_receipt_number VARCHAR(255),
    transaction_date TIMESTAMP,
    phone_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED, CANCELLED
    household_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);