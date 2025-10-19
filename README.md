# PGP Decrypt Lambda Function

This AWS Lambda function decrypts PGP encrypted files from S3 using a private key stored in AWS Secrets Manager.

## Features

- Retrieves PGP private key from AWS Secrets Manager
- Lists and processes encrypted files from S3
- Decrypts files using OpenPGP library
- Uploads decrypted files back to S3
- Comprehensive error handling and logging

## Prerequisites

1. AWS CLI configured with appropriate permissions
2. Node.js 18+ installed
3. Serverless Framework (optional, for deployment)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure AWS Secrets Manager

Store your PGP private key in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
    --name "pgp-key" \
    --description "PGP Private Key for file decryption" \
    --secret-string "-----BEGIN PGP PRIVATE KEY BLOCK-----
...
-----END PGP PRIVATE KEY BLOCK-----"
```

### 3. Configure S3 Bucket

Ensure the Lambda function has access to:
- S3 bucket: `sftp-file-sync-vivien`
- S3 prefix: `sync-files/`

## Deployment

### Using Serverless Framework

```bash
# Install Serverless Framework
npm install -g serverless

# Deploy the function
serverless deploy

# Deploy to specific stage
serverless deploy --stage production
```

### Manual Deployment

1. Create a deployment package:
```bash
zip -r pgp-decrypt-lambda.zip index.js node_modules/ package.json
```

2. Upload to AWS Lambda via AWS Console or CLI

## IAM Permissions

The Lambda execution role needs the following permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue"
            ],
            "Resource": "arn:aws:secretsmanager:*:*:secret:pgp-key*"
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
```

## Usage

### Manual Invocation

```bash
aws lambda invoke \
    --function-name pgp-decrypt-lambda-dev-decrypt-files \
    --payload '{}' \
    response.json
```

### S3 Event Trigger (Optional)

To automatically decrypt files when they're uploaded to S3, add an S3 event trigger in the serverless.yml:

```yaml
functions:
  decryptFiles:
    handler: index.handler
    events:
      - s3:
          bucket: sftp-file-sync-vivien
          event: s3:ObjectCreated:*
          rules:
            - prefix: sync-files/
```

## Configuration

### Environment Variables

- `AWS_REGION`: AWS region (default: us-east-1)

### Hardcoded Configuration

- S3 Bucket: `sftp-file-sync-vivien`
- S3 Prefix: `sync-files/`
- Secrets Manager Secret: `pgp-key`

## Output

The function returns a JSON response with:

```json
{
    "statusCode": 200,
    "body": {
        "message": "Processed X files. Success: Y, Failures: Z",
        "results": [
            {
                "originalFile": "sync-files/encrypted-file.gpg",
                "decryptedFile": "sync-files/encrypted-file.decrypted",
                "size": 1024,
                "lastModified": "2023-01-01T00:00:00.000Z"
            }
        ]
    }
}
```

## Error Handling

The function includes comprehensive error handling:

- Individual file processing errors don't stop the entire batch
- Detailed logging for troubleshooting
- Graceful handling of missing files or invalid PGP keys

## Monitoring

Monitor the function using:

- CloudWatch Logs for detailed execution logs
- CloudWatch Metrics for performance monitoring
- X-Ray for distributed tracing (if enabled)

## Security Considerations

1. PGP private key is stored securely in AWS Secrets Manager
2. Lambda execution role follows principle of least privilege
3. All file operations are logged for audit purposes
4. Decrypted files are stored in the same S3 bucket with `.decrypted` suffix
