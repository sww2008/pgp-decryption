#!/bin/bash

# PGP Decrypt Lambda Deployment Script

set -e

echo "🚀 Starting PGP Decrypt Lambda deployment..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install it first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install it first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create deployment package
echo "📦 Creating deployment package..."
zip -r pgp-decrypt-lambda.zip index.js node_modules/ package.json

echo "✅ Deployment package created: pgp-decrypt-lambda.zip"

# Check AWS credentials
echo "🔐 Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure' first."
    exit 1
fi

echo "✅ AWS credentials verified"

# Get AWS account ID and region
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "us-east-1")

echo "📋 AWS Account ID: $ACCOUNT_ID"
echo "📋 AWS Region: $REGION"

# Create IAM role if it doesn't exist
ROLE_NAME="pgp-decrypt-lambda-role"
echo "🔧 Creating IAM role: $ROLE_NAME"

# Trust policy for Lambda
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the role
aws iam create-role \
    --role-name $ROLE_NAME \
    --assume-role-policy-document file://trust-policy.json \
    2>/dev/null || echo "Role already exists"

# Attach basic execution policy
aws iam attach-role-policy \
    --role-name $ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Create custom policy for S3 and Secrets Manager access
cat > lambda-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:pgp-key*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::sftp-file-sync-vivien",
        "arn:aws:s3:::sftp-file-sync-vivien/*"
      ]
    }
  ]
}
EOF

# Create and attach custom policy
aws iam put-role-policy \
    --role-name $ROLE_NAME \
    --policy-name PGPDecryptLambdaPolicy \
    --policy-document file://lambda-policy.json

echo "✅ IAM role and policies configured"

# Create Lambda function
FUNCTION_NAME="pgp-decrypt-lambda"
echo "🔧 Creating Lambda function: $FUNCTION_NAME"

# Check if function exists
if aws lambda get-function --function-name $FUNCTION_NAME &> /dev/null; then
    echo "📝 Updating existing Lambda function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://pgp-decrypt-lambda.zip
else
    echo "📝 Creating new Lambda function..."
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs22.x \
        --role arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME \
        --handler index.handler \
        --zip-file fileb://pgp-decrypt-lambda.zip \
        --timeout 900 \
        --memory-size 1024 \
        --description "Decrypt PGP encrypted files from S3 using private key from Secrets Manager"
fi

echo "✅ Lambda function deployed successfully"

# Clean up temporary files
rm -f trust-policy.json lambda-policy.json pgp-decrypt-lambda.zip

echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Function Details:"
echo "   Function Name: $FUNCTION_NAME"
echo "   Runtime: nodejs22.x"
echo "   Handler: index.handler"
echo "   Timeout: 900 seconds"
echo "   Memory: 1024 MB"
echo ""
echo "🔧 Next Steps:"
echo "   1. Store your PGP private key in AWS Secrets Manager with name 'pgp-key'"
echo "   2. Test the function using AWS Console or CLI"
echo "   3. Set up CloudWatch monitoring and alerts"
echo ""
echo "🧪 Test the function:"
echo "   aws lambda invoke --function-name $FUNCTION_NAME --payload '{}' response.json"
