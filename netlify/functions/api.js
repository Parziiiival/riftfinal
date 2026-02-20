/**
 * Netlify Function: API Proxy
 * 
 * This function proxies requests from the frontend to the FastAPI backend.
 * 
 * Configuration:
 * Set the BACKEND_URL environment variable in Netlify to point to your backend server:
 * - Local development: http://localhost:8000
 * - Production: https://your-backend-url.com (e.g., Railway, Render, etc.)
 */

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

exports.handler = async (event, context) => {
    // Extract the path and query string
    const path = event.path.replace('/.netlify/functions/api', '');
    const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
    const method = event.httpMethod;
    const headers = event.headers;
    const body = event.body;
    const isBase64Encoded = event.isBase64Encoded;

    try {
        // Build the URL to forward to the backend
        const targetUrl = `${BACKEND_URL}${path}${queryString}`;
        
        console.log(`Proxying ${method} ${path} to ${targetUrl}`);

        // Prepare fetch options
        const fetchOptions = {
            method,
            headers: {
                // Remove host and connection headers
                ...Object.fromEntries(
                    Object.entries(headers).filter(
                        ([key]) => !['host', 'connection', 'content-length'].includes(key?.toLowerCase())
                    )
                ),
            },
        };

        // Add body if present
        if (body) {
            if (isBase64Encoded) {
                fetchOptions.body = Buffer.from(body, 'base64');
            } else {
                fetchOptions.body = body;
            }
        }

        // Forward the request to the backend
        const response = await fetch(targetUrl, fetchOptions);
        const responseBody = await response.text();

        return {
            statusCode: response.status,
            headers: {
                'Content-Type': response.headers.get('content-type') || 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: responseBody,
        };
    } catch (error) {
        console.error('Proxy error:', error);
        return {
            statusCode: 502,
            body: JSON.stringify({
                error: 'Bad Gateway',
                message: error.message,
                note: 'Backend server may be unavailable. Check BACKEND_URL environment variable.',
            }),
        };
    }
};
