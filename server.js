require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');

// Ensure upload directory exists
const facultyImgDir = path.join(__dirname, 'assets', 'img', 'faculty');
if (!fs.existsSync(facultyImgDir)) fs.mkdirSync(facultyImgDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'assets/img/faculty/'),
    filename: (req, file, cb) => cb(null, 'fac_' + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });



const app = express();
const PORT = process.env.PORT || 3000;
const AES_SECRET = process.env.AES_SECRET || 'fallback_secret_key_123';

// Simple in-memory cache to reduce DB load on public endpoints
const cache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
function getCache(key) {
    const entry = cache[key];
    if (entry && (Date.now() - entry.ts) < CACHE_TTL_MS) return entry.data;
    return null;
}
function setCache(key, data) {
    cache[key] = { data, ts: Date.now() };
}
function clearCache(key) {
    delete cache[key];
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from the current directory (the frontend)
app.use(express.static(path.join(__dirname)));

// MySQL Database Connection Pool
const dbConfig = {
    host: (process.env.DB_HOST || 'localhost').trim(),
    user: (process.env.DB_USER || 'root').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    database: (process.env.DB_NAME || 'medecnepal').trim()
};

const pool = mysql.createPool(dbConfig);

// Test database connection on startup
pool.getConnection()
    .then(connection => {
        console.log('✅ Successfully connected to AppServ MySQL database!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ MySQL connection error.', err.message);
    });

// API Routes
// 1. Handle Contact Form Submission
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, phone, subject, message } = req.body;
        
        if (!name || !email || !phone || !message) {
            return res.status(400).json({ error: 'Name, email, phone, and message are required.' });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Please provide a valid email address.' });
        }
        if (name.length < 2) {
            return res.status(400).json({ error: 'Name must be at least 2 characters long.' });
        }
        if (message.length < 10) {
            return res.status(400).json({ error: 'Message must be at least 10 characters long.' });
        }

        const query = `INSERT INTO inquiries (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)`;
        const [result] = await pool.execute(query, [name, email, phone, subject || 'No Subject', message]);
        
        res.status(201).json({ message: 'Thank you! Your message has been received.', id: result.insertId });
    } catch (error) {
        console.error('Error inserting inquiry:', error);
        res.status(500).json({ error: 'Database Error: ' + error.message });
    }
});

// 2. Handle Student Registration
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        if (!name || !email || !phone || !password) return res.status(400).json({ error: 'All fields are required.' });

        // Strong Validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return res.status(400).json({ error: 'Please provide a valid email address.' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters long.' });
        if (phone.length < 7) return res.status(400).json({ error: 'Please provide a valid contact number.' });

        // Check if user already exists
        const [existing] = await pool.execute('SELECT * FROM students WHERE email = ?', [email]);
        if (existing.length > 0) return res.status(409).json({ error: 'Email already registered.' });

        // Hash password and insert
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.execute('INSERT INTO students (name, email, phone, password_hash) VALUES (?, ?, ?, ?)', [name, email, phone, hashedPassword]);
        
        res.status(201).json({ message: 'Registration successful! You can now log in.' });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Database Error: ' + error.message });
    }
});

// 3. Handle Student Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

        // Find user
        const [users] = await pool.execute('SELECT * FROM students WHERE email = ?', [email]);
        if (users.length === 0) return res.status(401).json({ error: 'Invalid email or password.' });

        const user = users[0];

        // Compare password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.status(401).json({ error: 'Invalid email or password.' });

        // Generate JWT Token
        const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, process.env.JWT_SECRET || 'supersecretkey123', { expiresIn: '24h' });
        
        // Set secure HttpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        
        res.status(200).json({ message: 'Login successful!', user: { name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Database Error: ' + error.message });
    }
});

// 4. Logout Route
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.status(200).json({ message: 'Logged out successfully.' });
});

// Middleware for Protected Routes
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Access Denied. Please log in.' });

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey123');
        req.user = verified;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid or expired session.' });
    }
};

// Middleware for Admin Protected Routes
const authenticateAdmin = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Access Denied. Please log in.' });

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey123');
        if (verified.role !== 'admin') {
            return res.status(403).json({ error: 'Access Denied. Admins only.' });
        }
        req.user = verified;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid or expired session.' });
    }
};

// 5. Get Current User Profile and Enrollments
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get user details
        const [users] = await pool.execute(`
            SELECT id, CONCAT('MEDN', LPAD(id, 3, '0')) as medec_id, name, email, role 
            FROM students WHERE id = ?
        `, [userId]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found.' });

        // Get enrollments (for now, we just return empty or simulated if they bought nothing)
        const [enrollments] = await pool.execute(`
            SELECT c.* FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            WHERE e.student_id = ?
        `, [userId]);

        res.status(200).json({ 
            user: users[0], 
            enrolled_courses: enrollments 
        });
    } catch (error) {
        console.error('Fetch /me error:', error);
        res.status(500).json({ error: 'Database Error' });
    }
});

// 6. Get All Available Courses
app.get('/api/courses', authenticateToken, async (req, res) => {
    try {
        const [courses] = await pool.execute(`
            SELECT c.*, COUNT(e.id) as enrollment_count
            FROM courses c
            LEFT JOIN enrollments e ON c.id = e.course_id
            GROUP BY c.id
            ORDER BY enrollment_count DESC, c.id ASC
        `);
        if (courses.length > 0) courses[0].is_bestseller = true;
        res.status(200).json({ courses });
    } catch (error) {
        console.error('Fetch courses error:', error);
        res.status(500).json({ error: 'Database Error' });
    }
});

// 7. Get Public Courses (No Auth) - cached
app.get('/api/public/courses', async (req, res) => {
    try {
        const cached = getCache('public_courses');
        if (cached) {
            res.set('Cache-Control', 'public, max-age=300');
            return res.status(200).json(cached);
        }
        const [courses] = await pool.execute(`
            SELECT c.*, COUNT(e.id) as enrollment_count
            FROM courses c
            LEFT JOIN enrollments e ON c.id = e.course_id
            GROUP BY c.id
            ORDER BY enrollment_count DESC, c.id ASC
        `);
        if (courses.length > 0) courses[0].is_bestseller = true;
        const payload = { courses };
        setCache('public_courses', payload);
        res.set('Cache-Control', 'public, max-age=300');
        res.status(200).json(payload);
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// 8. Get Public Faculty (No Auth) - cached
app.get('/api/public/faculty', async (req, res) => {
    try {
        const cached = getCache('public_faculty');
        if (cached) {
            res.set('Cache-Control', 'public, max-age=300');
            return res.status(200).json(cached);
        }
        const [faculty] = await pool.execute('SELECT * FROM faculty ORDER BY id ASC');
        const payload = { faculty };
        setCache('public_faculty', payload);
        res.set('Cache-Control', 'public, max-age=300');
        res.status(200).json(payload);
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// ==========================================
// ADMIN ROUTES
// ==========================================

// Get all courses (Admin)
app.get('/api/admin/courses', authenticateAdmin, async (req, res) => {
    try {
        const [courses] = await pool.execute('SELECT * FROM courses');
        res.status(200).json({ courses });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// Add a new course (Admin)
app.post('/api/admin/courses', authenticateAdmin, async (req, res) => {
    try {
        const { title, description, price, features } = req.body;
        if (!title || !price) return res.status(400).json({ error: 'Title and price are required' });
        await pool.execute('INSERT INTO courses (title, description, price, features) VALUES (?, ?, ?, ?)', [title, description, price, features || '']);
        clearCache('public_courses');
        res.status(201).json({ message: 'Course created successfully' });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// Edit a course (Admin)
app.put('/api/admin/courses/:id', authenticateAdmin, async (req, res) => {
    try {
        const { title, description, price, features } = req.body;
        const courseId = req.params.id;
        if (!title || !price) return res.status(400).json({ error: 'Title and price are required' });
        
        await pool.execute('UPDATE courses SET title=?, description=?, price=?, features=? WHERE id=?', [title, description, price, features || '', courseId]);
        clearCache('public_courses');
        res.status(200).json({ message: 'Course updated successfully' });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// Delete a course (Admin)
app.delete('/api/admin/courses/:id', authenticateAdmin, async (req, res) => {
    try {
        await pool.execute('DELETE FROM courses WHERE id=?', [req.params.id]);
        clearCache('public_courses');
        res.status(200).json({ message: 'Course deleted successfully' });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// Get all faculty (Admin)
app.get('/api/admin/faculty', authenticateAdmin, async (req, res) => {
    try {
        const [faculty] = await pool.execute('SELECT * FROM faculty ORDER BY id DESC');
        res.status(200).json({ faculty });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// Add a new faculty member (Admin)
app.post('/api/admin/faculty', authenticateAdmin, upload.single('image'), async (req, res) => {
    try {
        const { name, subject, bio } = req.body;
        if (!name || !subject) return res.status(400).json({ error: 'Name and subject are required' });
        const image_url = req.file ? `assets/img/faculty/${req.file.filename}` : 'assets/img/hero-graphic.png';
        await pool.execute('INSERT INTO faculty (name, subject, bio, image_url) VALUES (?, ?, ?, ?)', [name, subject, bio || '', image_url]);
        clearCache('public_faculty');
        res.status(201).json({ message: 'Faculty created successfully' });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// Edit faculty member (Admin)
app.put('/api/admin/faculty/:id', authenticateAdmin, upload.single('image'), async (req, res) => {
    try {
        const { name, subject, bio } = req.body;
        const facultyId = req.params.id;
        if (!name || !subject) return res.status(400).json({ error: 'Name and subject are required' });
        
        let query = 'UPDATE faculty SET name=?, subject=?, bio=? WHERE id=?';
        let params = [name, subject, bio || '', facultyId];
        
        if (req.file) {
            query = 'UPDATE faculty SET name=?, subject=?, bio=?, image_url=? WHERE id=?';
            params = [name, subject, bio || '', `assets/img/faculty/${req.file.filename}`, facultyId];
        }
        
        await pool.execute(query, params);
        clearCache('public_faculty');
        res.status(200).json({ message: 'Faculty updated successfully' });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// Delete faculty member (Admin)
app.delete('/api/admin/faculty/:id', authenticateAdmin, async (req, res) => {
    try {
        await pool.execute('DELETE FROM faculty WHERE id=?', [req.params.id]);
        clearCache('public_faculty');
        res.status(200).json({ message: 'Faculty deleted successfully' });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// --- Mock Tests Engine (Admin) ---

// Create Mock Test
app.post('/api/admin/mock-tests', authenticateAdmin, async (req, res) => {
    try {
        const { title, description, duration_minutes, price } = req.body;
        if (!title || !duration_minutes) return res.status(400).json({ error: 'Title and duration are required' });
        await pool.execute('INSERT INTO mock_tests (title, description, duration_minutes, price) VALUES (?, ?, ?, ?)', [title, description || '', duration_minutes, price || 0]);
        res.status(201).json({ message: 'Mock test created' });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Get all Mock Tests
app.get('/api/admin/mock-tests', authenticateAdmin, async (req, res) => {
    try {
        const [tests] = await pool.query('SELECT * FROM mock_tests ORDER BY created_at DESC');
        res.json({ tests });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Edit Mock Test
app.put('/api/admin/mock-tests/:id', authenticateAdmin, async (req, res) => {
    try {
        const { title, description, duration_minutes, price } = req.body;
        await pool.execute('UPDATE mock_tests SET title=?, description=?, duration_minutes=?, price=? WHERE id=?', [title, description || '', duration_minutes, price || 0, req.params.id]);
        res.status(200).json({ message: 'Mock test updated' });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Public: Get all active tests (no auth required)
app.get('/api/public/mock-tests', async (req, res) => {
    try {
        const [tests] = await pool.query(`
            SELECT id, title, description, duration_minutes, price,
            (SELECT COUNT(*) FROM mock_questions WHERE test_id = t.id) as question_count
            FROM mock_tests t WHERE t.is_active = 1 ORDER BY t.created_at DESC
        `);
        res.json({ tests });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Delete Mock Test
app.delete('/api/admin/mock-tests/:id', authenticateAdmin, async (req, res) => {
    try {
        await pool.execute('DELETE FROM mock_tests WHERE id=?', [req.params.id]);
        res.status(200).json({ message: 'Mock test deleted' });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Toggle Active Status
app.patch('/api/admin/mock-tests/:id/toggle-active', authenticateAdmin, async (req, res) => {
    try {
        await pool.execute('UPDATE mock_tests SET is_active = NOT is_active WHERE id=?', [req.params.id]);
        const [rows] = await pool.query('SELECT is_active FROM mock_tests WHERE id=?', [req.params.id]);
        res.status(200).json({ is_active: rows[0].is_active });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Get Attempts for a Mock Test
app.get('/api/admin/mock-tests/:id/attempts', authenticateAdmin, async (req, res) => {
    try {
        const [attempts] = await pool.query(`
            SELECT a.*, s.name as student_name, s.email as student_email, CONCAT('MEDN', LPAD(s.id, 3, '0')) as medec_id
            FROM mock_attempts a 
            JOIN students s ON a.student_id = s.id 
            WHERE a.test_id = ? 
            ORDER BY a.completed_at DESC
        `, [req.params.id]);
        res.json({ attempts });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Create Question
app.post('/api/admin/mock-tests/:id/questions', authenticateAdmin, async (req, res) => {
    try {
        const { question_text, option_a, option_b, option_c, option_d, correct_option } = req.body;
        await pool.execute('INSERT INTO mock_questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)', 
        [req.params.id, question_text, option_a, option_b, option_c, option_d, correct_option]);
        res.status(201).json({ message: 'Question added' });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Bulk Import Questions from CSV
app.post('/api/admin/mock-tests/:id/questions/import', authenticateAdmin, async (req, res) => {
    try {
        const testId = req.params.id;
        const { csvText } = req.body;
        if (!csvText) return res.status(400).json({ error: 'No CSV data provided' });

        const lines = csvText.split('\n');
        let importedCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // Simple CSV parser to handle commas inside quotes
            let row = [];
            let cur = '';
            let inQuotes = false;
            for (let j = 0; j < line.length; j++) {
                const c = line[j];
                if (c === '"') inQuotes = !inQuotes;
                else if (c === ',' && !inQuotes) { row.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
                else cur += c;
            }
            row.push(cur.trim().replace(/^"|"$/g, ''));
            
            // Skip header if it exists
            if (i === 0 && row[0].toLowerCase().includes('question')) continue;
            
            if (row.length >= 6) {
                const qText = row[0];
                const optA = row[1];
                const optB = row[2];
                const optC = row[3];
                const optD = row[4];
                const correct = row[5].toUpperCase().replace(/[^ABCD]/g, '').charAt(0);
                
                if (qText && optA && correct) {
                    await pool.execute('INSERT INTO mock_questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                        [testId, qText, optA, optB, optC, optD, correct]);
                    importedCount++;
                }
            }
        }
        res.status(201).json({ message: `Successfully imported ${importedCount} questions` });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Database Error' }); }
});

// Get Questions for a test
app.get('/api/admin/mock-tests/:id/questions', authenticateAdmin, async (req, res) => {
    try {
        const [questions] = await pool.query('SELECT * FROM mock_questions WHERE test_id = ?', [req.params.id]);
        res.json({ questions });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Edit Question
app.put('/api/admin/mock-questions/:id', authenticateAdmin, async (req, res) => {
    try {
        const { question_text, option_a, option_b, option_c, option_d, correct_option } = req.body;
        await pool.execute('UPDATE mock_questions SET question_text=?, option_a=?, option_b=?, option_c=?, option_d=?, correct_option=? WHERE id=?', 
        [question_text, option_a, option_b, option_c, option_d, correct_option, req.params.id]);
        res.status(200).json({ message: 'Question updated' });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Delete Question
app.delete('/api/admin/mock-questions/:id', authenticateAdmin, async (req, res) => {
    try {
        await pool.execute('DELETE FROM mock_questions WHERE id=?', [req.params.id]);
        res.status(200).json({ message: 'Question deleted' });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Get all students (Admin)
app.get('/api/admin/students', authenticateAdmin, async (req, res) => {
    try {
        const [students] = await pool.execute(`
            SELECT id, CONCAT('MEDN', LPAD(id, 3, '0')) as medec_id, name, email, phone, created_at 
            FROM students WHERE role = 'student'
        `);
        res.status(200).json({ students: students.map(s => ({ ...s, phone: s.phone ? s.phone.toString() : null })) });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// Get all inquiries (Admin)
app.get('/api/admin/inquiries', authenticateAdmin, async (req, res) => {
    try {
        const [inquiries] = await pool.execute(`
            SELECT id, name, email, phone, subject, message, created_at 
            FROM inquiries ORDER BY created_at DESC
        `);
        res.status(200).json({ inquiries: inquiries.map(i => ({ ...i, phone: i.phone ? i.phone.toString() : null })) });
    } catch (error) { res.status(500).json({ error: 'Database Error' }); }
});

// --- Mock Tests Engine (Student) ---

// Get available Mock Tests (students only see active tests)
app.get('/api/student/mock-tests', authenticateToken, async (req, res) => {
    try {
        const studentId = req.user.id;
        const [tests] = await pool.query(`
            SELECT t.*, 
            (SELECT score FROM mock_attempts WHERE test_id = t.id AND student_id = ? ORDER BY completed_at DESC LIMIT 1) as last_score,
            (SELECT total_questions FROM mock_attempts WHERE test_id = t.id AND student_id = ? ORDER BY completed_at DESC LIMIT 1) as last_total
            FROM mock_tests t WHERE t.is_active = 1 ORDER BY t.created_at DESC
        `, [studentId, studentId]);
        res.json({ tests });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Get all past attempts for the current student
app.get('/api/student/mock-tests/attempts', authenticateToken, async (req, res) => {
    try {
        const studentId = req.user.id;
        const [attempts] = await pool.query(`
            SELECT a.*, t.title as test_title
            FROM mock_attempts a 
            JOIN mock_tests t ON a.test_id = t.id 
            WHERE a.student_id = ? 
            ORDER BY a.completed_at DESC
        `, [studentId]);
        res.json({ attempts });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Start a Mock Test (fetch questions WITHOUT correct answers)
app.get('/api/student/mock-tests/:id/start', authenticateToken, async (req, res) => {
    try {
        const studentId = req.user.id;
        
        // Check if already taken
        const [attempts] = await pool.query('SELECT id FROM mock_attempts WHERE student_id = ? AND test_id = ?', [studentId, req.params.id]);
        if (attempts.length > 0) {
            return res.status(403).json({ error: 'You have already completed this test.' });
        }

        const [test] = await pool.query('SELECT * FROM mock_tests WHERE id = ?', [req.params.id]);
        if (test.length === 0) return res.status(404).json({ error: 'Test not found' });
        
        // Exclude 'correct_option' from the payload to prevent cheating
        const [questions] = await pool.query('SELECT id, test_id, question_text, option_a, option_b, option_c, option_d FROM mock_questions WHERE test_id = ?', [req.params.id]);
        
        res.json({ test: test[0], questions });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Submit Mock Test Attempt
app.post('/api/student/mock-tests/:id/submit', authenticateToken, async (req, res) => {
    try {
        const studentId = req.user.id;
        const testId = req.params.id;
        const { answers } = req.body; // { "questionId": "A", "questionId": "B" }
        
        // Check if already taken
        const [attempts] = await pool.query('SELECT id FROM mock_attempts WHERE student_id = ? AND test_id = ?', [studentId, testId]);
        if (attempts.length > 0) {
            return res.status(403).json({ error: 'You have already completed this test.' });
        }
        
        const [questions] = await pool.query('SELECT id, correct_option FROM mock_questions WHERE test_id = ?', [testId]);
        let score = 0;
        
        // Grade the test
        questions.forEach(q => {
            if (answers && answers[q.id] && answers[q.id] === q.correct_option) {
                score++;
            }
        });
        
        const totalQuestions = questions.length;
        
        // Save Attempt
        await pool.execute('INSERT INTO mock_attempts (student_id, test_id, score, total_questions, completed_at) VALUES (?, ?, ?, ?, NOW())', 
            [studentId, testId, score, totalQuestions]);
            
        res.status(200).json({ score, totalQuestions, message: 'Test submitted successfully' });
    } catch (e) { res.status(500).json({ error: 'Database Error' }); }
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
