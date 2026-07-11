// Vercel serverless entry: reuse the Express app từ src/server.js.
// isVercel = true → app không gọi app.listen(); chỉ export handler.
module.exports = require('../src/server');
