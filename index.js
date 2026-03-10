/**
 * URL Shortening Service
 * Express.js REST API for creating and resolving short URLs
 * with click analytics and expiration support.
 * @author Gabriel Demetrios Lafis
 */

const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());

// In-memory storage
const urlStore = new Map();
const analyticsStore = new Map();

/**
 * Generate a short code from a URL
 */
function generateShortCode(url, length = 6) {
    const hash = crypto.createHash('sha256').update(url + Date.now().toString()).digest('hex');
    return hash.substring(0, length);
}

/**
 * Validate URL format
 */
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Check if a shortened URL has expired
 */
function isExpired(entry) {
    if (!entry.expiresAt) return false;
    return new Date() > new Date(entry.expiresAt);
}

/**
 * Record a click event for analytics
 */
function recordClick(shortCode, req) {
    if (!analyticsStore.has(shortCode)) {
        analyticsStore.set(shortCode, []);
    }
    analyticsStore.get(shortCode).push({
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent'] || 'unknown',
        referer: req.headers['referer'] || 'direct',
        ip: req.ip || req.connection.remoteAddress
    });
}

// --- API Routes ---

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        totalUrls: urlStore.size,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Create short URL
app.post('/api/shorten', (req, res) => {
    const { url, customCode, expiresIn } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL format. Must start with http:// or https://' });
    }

    // Check for existing URL
    for (const [code, entry] of urlStore.entries()) {
        if (entry.originalUrl === url && !isExpired(entry) && !customCode) {
            return res.json({
                shortUrl: `${BASE_URL}/${code}`,
                shortCode: code,
                originalUrl: url,
                existing: true
            });
        }
    }

    let shortCode;
    if (customCode) {
        if (urlStore.has(customCode)) {
            return res.status(409).json({ error: 'Custom code already in use' });
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(customCode) || customCode.length < 3 || customCode.length > 20) {
            return res.status(400).json({ error: 'Custom code must be 3-20 alphanumeric characters' });
        }
        shortCode = customCode;
    } else {
        shortCode = generateShortCode(url);
        while (urlStore.has(shortCode)) {
            shortCode = generateShortCode(url + Math.random());
        }
    }

    const entry = {
        originalUrl: url,
        shortCode,
        createdAt: new Date().toISOString(),
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
        clicks: 0
    };

    urlStore.set(shortCode, entry);

    res.status(201).json({
        shortUrl: `${BASE_URL}/${shortCode}`,
        shortCode,
        originalUrl: url,
        expiresAt: entry.expiresAt,
        existing: false
    });
});

// Redirect short URL
app.get('/:code', (req, res) => {
    const { code } = req.params;

    // Skip API routes
    if (code === 'api') return res.status(404).json({ error: 'Not found' });

    const entry = urlStore.get(code);

    if (!entry) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    if (isExpired(entry)) {
        urlStore.delete(code);
        return res.status(410).json({ error: 'Short URL has expired' });
    }

    entry.clicks++;
    recordClick(code, req);

    res.redirect(301, entry.originalUrl);
});

// Get URL info
app.get('/api/urls/:code', (req, res) => {
    const entry = urlStore.get(req.params.code);

    if (!entry) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    res.json({
        ...entry,
        shortUrl: `${BASE_URL}/${entry.shortCode}`,
        isExpired: isExpired(entry)
    });
});

// Get analytics for a short URL
app.get('/api/urls/:code/analytics', (req, res) => {
    const entry = urlStore.get(req.params.code);

    if (!entry) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    const clicks = analyticsStore.get(req.params.code) || [];
    const last24h = clicks.filter(c =>
        new Date(c.timestamp) > new Date(Date.now() - 86400000)
    );

    res.json({
        shortCode: req.params.code,
        totalClicks: entry.clicks,
        clicksLast24h: last24h.length,
        recentClicks: clicks.slice(-10),
        createdAt: entry.createdAt
    });
});

// List all URLs
app.get('/api/urls', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const entries = Array.from(urlStore.values());
    const start = (page - 1) * limit;
    const paged = entries.slice(start, start + limit);

    res.json({
        urls: paged.map(e => ({
            ...e,
            shortUrl: `${BASE_URL}/${e.shortCode}`,
            isExpired: isExpired(e)
        })),
        total: entries.length,
        page,
        totalPages: Math.ceil(entries.length / limit)
    });
});

// Delete a short URL
app.delete('/api/urls/:code', (req, res) => {
    const entry = urlStore.get(req.params.code);

    if (!entry) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    urlStore.delete(req.params.code);
    analyticsStore.delete(req.params.code);

    res.json({ message: 'Short URL deleted', shortCode: req.params.code });
});

// Start server
app.listen(PORT, () => {
    console.log(`URL Shortener running on port ${PORT}`);
    console.log(`Base URL: ${BASE_URL}`);
});

module.exports = { app, generateShortCode, isValidUrl };
