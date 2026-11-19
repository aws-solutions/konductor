// Search module for AutoPartsDirect
// Current implementation uses PostgreSQL full-text search

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'autoparts',
  user: process.env.DB_USER || 'app_user',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
});

/**
 * Search for parts by query
 * @param {string} query - Search query
 * @param {number} limit - Maximum results (default 20)
 * @returns {Promise<Array>} Search results
 */
async function searchParts(query, limit = 20) {
  const client = await pool.connect();
  
  try {
    // Check if query looks like a part number
    const partNumberPattern = /^[A-Z]{0,3}[\s\-]*\d+[\s\-]*[A-Z]*\d*$/i;
    const isPartNumber = partNumberPattern.test(query);
    
    if (isPartNumber) {
      // Clean up part number - remove spaces and dashes
      const cleanedQuery = query.replace(/[\s\-]/g, '');
      
      // Exact match search on part_number column
      const exactResult = await client.query(
        `SELECT id, part_number, description, category, price, in_stock 
         FROM products 
         WHERE part_number = $1 
         LIMIT $2`,
        [cleanedQuery, limit]
      );
      
      if (exactResult.rows.length > 0) {
        return exactResult.rows;
      }
      
      // Try partial match if exact fails
      const partialResult = await client.query(
        `SELECT id, part_number, description, category, price, in_stock 
         FROM products 
         WHERE part_number LIKE $1 
         LIMIT $2`,
        [`%${cleanedQuery}%`, limit]
      );
      
      return partialResult.rows;
    } else {
      // Text search using PostgreSQL full-text search
      const textResult = await client.query(
        `SELECT id, part_number, description, category, price, in_stock,
                ts_rank_cd(search_vector, plainto_tsquery('english', $1)) as rank
         FROM products 
         WHERE search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC, in_stock DESC
         LIMIT $2`,
        [query, limit]
      );
      
      return textResult.rows;
    }
  } finally {
    client.release();
  }
}

/**
 * Log search query for analytics
 * @param {string} query - Original query
 * @param {number} resultCount - Number of results returned
 * @param {string} sessionId - User session ID
 */
async function logSearch(query, resultCount, sessionId) {
  const client = await pool.connect();
  
  try {
    await client.query(
      `INSERT INTO search_logs (query, result_count, session_id, timestamp)
       VALUES ($1, $2, $3, NOW())`,
      [query, resultCount, sessionId]
    );
  } catch (error) {
    console.error('Failed to log search:', error);
  } finally {
    client.release();
  }
}

module.exports = {
  searchParts,
  logSearch,
};