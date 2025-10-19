# PGP Decrypt Lambda with node-gpg

This version uses the `node-gpg` library which wraps the GPG command-line tool for PGP operations.

## Key Differences from OpenPGP Version

### Dependencies
- **node-gpg**: Wraps GPG command-line tool
- **No OpenPGP.js**: Removes the pure JavaScript OpenPGP implementation

### Requirements
- **GPG Binary**: Requires GPG to be installed in the Lambda environment
- **Lambda Layer**: Use the provided layer setup script to include GPG

### Advantages
- ✅ **Most Reliable**: Uses the official GPG binary
- ✅ **Full Feature Support**: All GPG features available
- ✅ **Battle Tested**: GPG is the industry standard

### Disadvantages
- ❌ **Larger Package**: Requires GPG binary and dependencies
- ❌ **Slower**: Process spawning overhead
- ❌ **Complex Setup**: Requires Lambda layer with GPG

## Setup Instructions

### 1. Manual Lambda Setup

You'll need to set up the Lambda function manually with GPG support. This typically involves:

- Creating a Lambda layer with GPG binary and dependencies
- Configuring the Lambda function with the appropriate runtime and layers
- Setting up IAM roles and permissions

### 2. Environment Variables

Set the PGP passphrase as an environment variable:

```bash
aws lambda update-function-configuration \
  --function-name pgp-decrypt-lambda \
  --environment Variables='{PGP_PASSPHRASE=your-secret-passphrase}'
```

## Configuration

### Environment Variables
- `PGP_PASSPHRASE`: Passphrase for the PGP private key (default: 'default-passphrase')

### AWS Secrets Manager
- **Secret Name**: `pgp-key`
- **Content**: PGP private key in armored format

### S3 Configuration
- **Bucket**: `sftp-file-sync-vivien`
- **Prefix**: `sync-files/`

## Usage

The function works the same way as the OpenPGP version:

1. **Retrieves** PGP private key from AWS Secrets Manager
2. **Lists** encrypted files from S3
3. **Downloads** each encrypted file
4. **Decrypts** using GPG command-line tool
5. **Uploads** decrypted files back to S3

## Performance Considerations

### Memory Usage
- **Base Function**: ~50MB
- **With GPG Layer**: ~100MB
- **Recommended**: 512MB+ memory allocation

### Execution Time
- **Per File**: 2-5 seconds (due to GPG process spawning)
- **Large Files**: May take longer
- **Timeout**: Recommended 900 seconds (15 minutes)

## Troubleshooting

### Common Issues

1. **GPG Not Found**
   ```
   Error: gpg: command not found
   ```
   **Solution**: Ensure the GPG layer is attached to your Lambda function

2. **Permission Denied**
   ```
   Error: gpg: can't create directory
   ```
   **Solution**: Check Lambda execution role has write permissions to `/tmp`

3. **Passphrase Issues**
   ```
   Error: gpg: decryption failed: No secret key
   ```
   **Solution**: Verify the passphrase and private key format

### Debugging

Enable detailed logging by setting the log level:

```bash
aws lambda update-function-configuration \
  --function-name pgp-decrypt-lambda \
  --environment Variables='{LOG_LEVEL=debug,PGP_PASSPHRASE=your-passphrase}'
```

## Security Notes

- **Passphrase**: Store in environment variables or AWS Secrets Manager
- **Temporary Files**: Automatically cleaned up after each operation
- **Key Storage**: Private key stored securely in AWS Secrets Manager
- **Access Control**: Lambda role follows principle of least privilege

## Alternative Approaches

If you encounter issues with the GPG layer approach, consider:

1. **Custom Runtime**: Use a custom Lambda runtime with GPG pre-installed
2. **Container Image**: Deploy as a container with GPG included
3. **Hybrid Approach**: Use OpenPGP.js for simple cases, GPG for complex ones
