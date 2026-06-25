require('dotenv').config();
const mysql = require('mysql2/promise');

async function upgradeCourses() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'medecnepal'
        });

        console.log("Connected. Upgrading courses table...");
        
        // Add features column if it doesn't exist
        try {
            await connection.query('ALTER TABLE courses ADD COLUMN features TEXT');
            console.log("✅ 'features' column added.");
            // Seed existing courses with default features
            await connection.query('UPDATE courses SET features = "Expert Faculty, Exam Focused" WHERE features IS NULL');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("⚠️ 'features' column already exists.");
            } else {
                throw e;
            }
        }

        await connection.end();
    } catch (err) {
        console.error("❌ Error:", err.message);
    }
}

upgradeCourses();
