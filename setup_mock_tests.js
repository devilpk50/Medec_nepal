require('dotenv').config();
const mysql = require('mysql2/promise');

async function setupMockTests() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'medecnepal'
        });

        console.log("Connected to MySQL. Creating Mock Test tables...");

        // 1. Create Mock Tests Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS mock_tests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                duration_minutes INT NOT NULL DEFAULT 60,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ 'mock_tests' table created.");

        // 2. Create Mock Questions Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS mock_questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                test_id INT NOT NULL,
                question_text TEXT NOT NULL,
                option_a VARCHAR(255) NOT NULL,
                option_b VARCHAR(255) NOT NULL,
                option_c VARCHAR(255) NOT NULL,
                option_d VARCHAR(255) NOT NULL,
                correct_option CHAR(1) NOT NULL, -- 'A', 'B', 'C', or 'D'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (test_id) REFERENCES mock_tests(id) ON DELETE CASCADE
            );
        `);
        console.log("✅ 'mock_questions' table created.");

        // 3. Create Mock Attempts Table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS mock_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_id INT NOT NULL,
                test_id INT NOT NULL,
                score INT NOT NULL,
                total_questions INT NOT NULL,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP NULL,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                FOREIGN KEY (test_id) REFERENCES mock_tests(id) ON DELETE CASCADE
            );
        `);
        console.log("✅ 'mock_attempts' table created.");

        await connection.end();
        console.log("🎉 Mock Tests Engine database setup complete!");
    } catch (err) {
        console.error("❌ Error setting up database:", err.message);
    }
}

setupMockTests();
