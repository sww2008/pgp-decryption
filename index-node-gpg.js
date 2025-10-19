const AWS = require('aws-sdk');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Initialize AWS services
const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'us-east-1' });
const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Retrieves PGP private key from AWS Secrets Manager
 * @param {string} secretName - Name of the secret containing the PGP key
 * @returns {Promise<string>} - The PGP private key
 */
async function getPGPPrivateKey(secretName = 'pgp-key') {
    try {
        console.log(`Retrieving PGP private key from secret: ${secretName}`);
        
        const params = {
            SecretId: secretName
        };
        
        const result = await secretsManager.getSecretValue(params).promise();
        
        if (result.SecretString) {
            console.log('Successfully retrieved PGP private key from Secrets Manager');
            return result.SecretString;
        } else {
            throw new Error('Secret value is not a string');
        }
    } catch (error) {
        console.error('Error retrieving PGP private key:', error);
        throw new Error(`Failed to retrieve PGP private key: ${error.message}`);
    }
}

/**
 * Lists all encrypted files from the specified S3 bucket and prefix
 * @param {string} bucketName - S3 bucket name
 * @param {string} prefix - S3 prefix/path
 * @returns {Promise<Array>} - Array of file objects
 */
async function listEncryptedFiles(bucketName, prefix) {
    try {
        console.log(`Listing files from s3://${bucketName}/${prefix}`);
        
        const params = {
            Bucket: bucketName,
            Prefix: prefix
        };
        
        const result = await s3.listObjectsV2(params).promise();
        
        console.log(`Found ${result.Contents.length} files`);
        return result.Contents || [];
    } catch (error) {
        console.error('Error listing files from S3:', error);
        throw new Error(`Failed to list files from S3: ${error.message}`);
    }
}

/**
 * Downloads a file from S3
 * @param {string} bucketName - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<Buffer>} - File content as Buffer
 */
async function downloadFileFromS3(bucketName, key) {
    try {
        console.log(`Downloading file: s3://${bucketName}/${key}`);
        
        const params = {
            Bucket: bucketName,
            Key: key
        };
        
        const result = await s3.getObject(params).promise();
        return result.Body;
    } catch (error) {
        console.error(`Error downloading file ${key}:`, error);
        throw new Error(`Failed to download file ${key}: ${error.message}`);
    }
}

/**
 * Uploads decrypted content back to S3
 * @param {string} bucketName - S3 bucket name
 * @param {string} key - S3 object key (original encrypted file path)
 * @param {Buffer} decryptedContent - Decrypted file content
 * @returns {Promise<Object>} - S3 upload result
 */
async function uploadDecryptedFile(bucketName, key, decryptedContent) {
    try {
        // Create decrypted file path by removing .gpg extension if present
        const decryptedKey = key.endsWith('.gpg') ? key.slice(0, -4) : `${key}.decrypted`;
        
        console.log(`Uploading decrypted file: s3://${bucketName}/${decryptedKey}`);
        
        const params = {
            Bucket: bucketName,
            Key: decryptedKey,
            Body: decryptedContent,
            ContentType: 'application/octet-stream'
        };
        
        const result = await s3.upload(params).promise();
        console.log(`Successfully uploaded decrypted file: ${result.Location}`);
        return result;
    } catch (error) {
        console.error(`Error uploading decrypted file:`, error);
        throw new Error(`Failed to upload decrypted file: ${error.message}`);
    }
}

/**
 * Decrypts a file using GPG command line tool
 * @param {Buffer} encryptedData - Encrypted file data
 * @param {string} privateKeyArmored - PGP private key in armored format
 * @param {string} passphrase - Passphrase for the private key
 * @returns {Promise<Buffer>} - Decrypted file content
 */
async function decryptFileWithGPG(encryptedData, privateKeyArmored, passphrase) {
    try {
        console.log('Starting GPG decryption process');
        
        // Import the private key
        const importCommand = `echo '${privateKeyArmored}' | gpg --import --batch --yes`;
        await execAsync(importCommand);
        
        // Decrypt the file using GPG
        const decryptCommand = `echo '${encryptedData.toString('base64')}' | base64 -d | gpg --decrypt --batch --yes --passphrase '${passphrase}'`;
        const { stdout } = await execAsync(decryptCommand);
        
        console.log('GPG decryption completed successfully');
        return Buffer.from(stdout);
    } catch (error) {
        console.error('Error during GPG decryption:', error);
        throw new Error(`Failed to decrypt file: ${error.message}`);
    }
}

/**
 * Main Lambda handler function
 * @param {Object} event - Lambda event object
 * @param {Object} context - Lambda context object
 * @returns {Promise<Object>} - Lambda response
 */
exports.handler = async (event, context) => {
    console.log('Lambda function started');
    console.log('Event:', JSON.stringify(event, null, 2));
    
    try {
        // Configuration
        const bucketName = 'sftp-file-sync-vivien';
        const prefix = 'sync-files/';
        const secretName = 'pgp-key';
        const passphrase = process.env.PGP_PASSPHRASE || 'default-passphrase';
        
        // Get PGP private key from Secrets Manager
        const privateKey = await getPGPPrivateKey(secretName);
        
        // List all files in the S3 bucket/prefix
        const files = await listEncryptedFiles(bucketName, prefix);
        
        if (files.length === 0) {
            console.log('No files found to decrypt');
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'No files found to decrypt',
                    decryptedFiles: []
                })
            };
        }
        
        const results = [];
        
        // Process each file
        for (const file of files) {
            try {
                console.log(`Processing file: ${file.Key}`);
                
                // Skip if file is a directory
                if (file.Key.endsWith('/')) {
                    console.log(`Skipping directory: ${file.Key}`);
                    continue;
                }
                
                // Download encrypted file
                const encryptedData = await downloadFileFromS3(bucketName, file.Key);
                
                // Decrypt the file using GPG
                const decryptedData = await decryptFileWithGPG(encryptedData, privateKey, passphrase);
                
                // Upload decrypted file
                const uploadResult = await uploadDecryptedFile(bucketName, file.Key, decryptedData);
                
                results.push({
                    originalFile: file.Key,
                    decryptedFile: uploadResult.Key,
                    size: file.Size,
                    lastModified: file.LastModified
                });
                
                console.log(`Successfully processed file: ${file.Key}`);
                
            } catch (fileError) {
                console.error(`Error processing file ${file.Key}:`, fileError);
                results.push({
                    originalFile: file.Key,
                    error: fileError.message,
                    status: 'failed'
                });
            }
        }
        
        const successCount = results.filter(r => !r.error).length;
        const failureCount = results.filter(r => r.error).length;
        
        console.log(`Processing completed. Success: ${successCount}, Failures: ${failureCount}`);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Processed ${files.length} files. Success: ${successCount}, Failures: ${failureCount}`,
                results: results
            })
        };
        
    } catch (error) {
        console.error('Lambda function error:', error);
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        };
    }
};
