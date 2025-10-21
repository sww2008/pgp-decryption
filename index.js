const AWS = require('aws-sdk');
const openpgp = require('openpgp');

// Initialize AWS services
const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'ap-southeast-2' });
const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-southeast-2' });

/**
 * Retrieves PGP private key and passphrase from AWS Secrets Manager
 * @param {string} secretName - Name of the secret containing the PGP key and passphrase
 * @param {string} keyName - Name of the key field in the secret (defaults to 'pgp-key')
 * @returns {Promise<Object>} - Object containing privateKey and passphrase
 */
async function getPGPPrivateKey(secretName, keyName = 'pgp-key') {
  try {
    console.log(`Retrieving PGP private key and passphrase from secret: ${secretName}`);
    console.log(`Using key name: ${keyName}`);

    const params = {
      SecretId: secretName
    };

    const result = await secretsManager.getSecretValue(params).promise();

    if (result.SecretString) {
      console.log('Successfully retrieved secret from Secrets Manager');

      // Parse the secret string to extract private key and passphrase
      const secretData = JSON.parse(result.SecretString);

      if (!secretData[keyName]) {
        throw new Error(`Secret does not contain ${keyName} field`);
      }

      return {
        privateKey: secretData[keyName],
        passphrase: secretData.passphrase || null
      };
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
 * @param {string} encryptedPrefix - Prefix where decrypted files should be saved
 * @returns {Promise<Object>} - S3 upload result
 */
async function uploadDecryptedFile(bucketName, key, decryptedContent, encryptedPrefix) {
  try {
    // Create decrypted file path by removing .gpg extension if present and placing in encrypted prefix
    const fileName = key.split('/').pop(); // Get just the filename
    const decryptedFileName = fileName.endsWith('.gpg') ? fileName.slice(0, -4) : `${fileName}.decrypted`;
    const decryptedKey = `${decryptedPrefix}${decryptedFileName}`;

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
 * Decrypts a file using PGP private key
 * @param {Buffer} encryptedData - Encrypted file data
 * @param {string} privateKeyArmored - PGP private key in armored format
 * @param {string} passphrase - Optional passphrase for the private key
 * @returns {Promise<Buffer>} - Decrypted file content
 */
async function decryptFile(encryptedData, privateKeyArmored, passphrase) {
  try {
    console.log('Starting PGP decryption process');

    // Read the private key
    let privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });

    // If passphrase is provided, decrypt the private key
    if (passphrase) {
      console.log('Decrypting private key with passphrase...');
      privateKey = await openpgp.decryptKey({
        privateKey: privateKey,
        passphrase: passphrase
      });
    }

    // Read the encrypted message
    const message = await openpgp.readMessage({ binaryMessage: encryptedData });

    // Decrypt the message
    const { data: decryptedData } = await openpgp.decrypt({
      message,
      decryptionKeys: privateKey
    });

    console.log('PGP decryption completed successfully');
    return decryptedData;
  } catch (error) {
    console.error('Error during PGP decryption:', error);
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
    // Configuration from environment variables
    const bucketName = process.env.bucketName || process.env.S3_BUCKET_NAME || 'sftp-file-sync-vivien';
    const prefix = process.env.S3_PREFIX;
    const secretName = process.env.secretName || process.env.SECRET_NAME;
    const awsRegion = process.env.AWS_REGION || 'ap-southeast-2';
    const privateKey = process.env.privateKey;
    const passphrase = process.env.passphrase;
    const keyName = process.env.keyName;
    const encryptedPrefix = process.env.encryptedPrefix || 'encrypt_files/';
    const decryptedPrefix = process.env.decryptedPrefix || 'decrypt_files/';

    console.log(`Configuration:
        - S3 Bucket: ${bucketName}
        - S3 Prefix: ${prefix}
        - Secret Name: ${secretName}
        - AWS Region: ${awsRegion}
        - Private Key: ${privateKey ? '[PROVIDED]' : '[FROM SECRET]'}
        - Passphrase: ${passphrase ? '[PROVIDED]' : '[FROM SECRET]'}
        - Key Name: ${keyName || '[NOT SET]'}
        - Encrypted Prefix: ${encryptedPrefix}
        - Decrypted Prefix: ${decryptedPrefix}`);

    // Get PGP private key and passphrase from environment variables or Secrets Manager
    let pgpPrivateKey, pgpPassphrase;
    
    if (privateKey) {
      // Use private key from environment variable
      pgpPrivateKey = privateKey;
      pgpPassphrase = passphrase;
      console.log('Using private key and passphrase from environment variables');
    } else {
      // Fall back to Secrets Manager
      const secretData = await getPGPPrivateKey(secretName, keyName);
      pgpPrivateKey = secretData.privateKey;
      pgpPassphrase = secretData.passphrase;
      console.log('Retrieved private key and passphrase from Secrets Manager');
    }

    console.log(`PGP Configuration:
        - Private Key: ${pgpPrivateKey ? '[LOADED]' : '[NOT FOUND]'}
        - Passphrase: ${pgpPassphrase ? '[SET]' : '[NOT SET]'}`);

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

        // Decrypt the file
        const decryptedData = await decryptFile(encryptedData, pgpPrivateKey, pgpPassphrase);

        // Upload decrypted file
        const uploadResult = await uploadDecryptedFile(bucketName, file.Key, decryptedData, decryptedPrefix);

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
