#!/bin/bash

# Test script to verify upload functionality
# This creates a test image and uploads it

echo "Creating test image..."

# Create a simple test JPEG using ImageMagick or base64
# This is a minimal valid JPEG
cat > test-image.jpg << 'EOF'
/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==
EOF

echo "Test image created: test-image.jpg"
echo ""
echo "Testing upload to http://localhost:3000/api/upload"
echo ""

# Upload the image
RESPONSE=$(curl -s -X POST http://localhost:3000/api/upload \
  -F "image=@test-image.jpg" \
  -w "\nHTTP_STATUS:%{http_code}")

# Extract HTTP status
HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS")

echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""
echo "HTTP Status: $HTTP_STATUS"

# Check if upload was successful
if [ "$HTTP_STATUS" = "202" ]; then
    echo "✅ Upload successful!"
    
    # Extract jobId
    JOB_ID=$(echo "$BODY" | jq -r '.jobId' 2>/dev/null)
    
    if [ ! -z "$JOB_ID" ] && [ "$JOB_ID" != "null" ]; then
        echo "Job ID: $JOB_ID"
        echo ""
        echo "Checking status..."
        sleep 2
        
        curl -s "http://localhost:3000/api/status/$JOB_ID" | jq '.'
    fi
else
    echo "❌ Upload failed with status $HTTP_STATUS"
    echo "Make sure:"
    echo "  1. Server is running (npm run dev)"
    echo "  2. MongoDB is connected"
    echo "  3. Port 3000 is available"
fi

# Cleanup
rm -f test-image.jpg

echo ""
echo "Test complete!"
