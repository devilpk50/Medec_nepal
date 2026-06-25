require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function setupAdmin() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'medecnepal'
        });

        console.log("Connected to MySQL. Upgrading tables...");

        // 1. Add role column if it doesn't exist
        try {
            await connection.query(`ALTER TABLE students ADD COLUMN role ENUM('student', 'admin') DEFAULT 'student' AFTER phone;`);
            console.log("✅ Added role column to students table");
        } catch(e) {
            console.log("Role column already exists or error: " + e.message);
        }

        // 2. Create the superadmin account
        const adminEmail = 'superadmin@medecnepal.com';
        const adminPassword = 'superadmin123';
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        
        // AES encryption needs the key
        const AES_SECRET = process.env.AES_SECRET || 'a8B2c5D9e3F1g7H4i6J0k9L5m2N8o1P7';

        // Check if superadmin exists
        const [existing] = await connection.query('SELECT id FROM students WHERE email = ?', [adminEmail]);
        if (existing.length === 0) {
            await connection.query(
                `INSERT INTO students (name, email, phone, role, password_hash) VALUES (?, ?, AES_ENCRYPT(?, ?), 'admin', ?)`,
                ['Super Admin', adminEmail, '0000000000', AES_SECRET, hashedPassword]
            );
            console.log(`✅ Superadmin created! Email: ${adminEmail} | Password: ${adminPassword}`);
        } else {
            console.log("⚠️ Superadmin already exists.");
        }

        await connection.end();
    } catch (err) {
        console.error("❌ Error setting up admin:", err.message);
    }
}

setupAdmin();
