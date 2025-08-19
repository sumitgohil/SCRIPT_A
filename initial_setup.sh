#!/bin/bash

# Simple setup script for TaskFlow API
echo "Setting up TaskFlow API..."

# Check if we have the right tools
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

if ! command -v bun &> /dev/null && ! command -v npm &> /dev/null; then
    echo "❌ Neither bun nor npm found. Please install one of them."
    exit 1
fi

# Use bun if available, otherwise npm
if command -v bun &> /dev/null; then
    echo "✅ Using bun"
    PM="bun"
else
    echo "✅ Using npm"
    PM="npm"
fi

# Install dependencies
echo "Installing dependencies..."
$PM install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ Created .env file from .env.example"
        echo "⚠️  Please edit .env with your database credentials"
    else
        echo "❌ .env.example not found. Please create .env manually."
        exit 1
    fi
fi

# Run migrations
echo "Running database migrations..."
$PM run migration:custom

# Seed with bulk data
echo "Seeding database with bulk data..."
$PM run seed:bulk

echo ""
echo "🎉 Setup complete!"
echo "Starting development server..."
echo "API will be available at: http://localhost:3000"
echo "Swagger docs at: http://localhost:3000/api"
echo "Press Ctrl+C to stop"
echo ""

# Start the server
$PM run start:dev
