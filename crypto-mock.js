const ExpoCrypto = require('expo-crypto');

module.exports = {
  randomBytes: (size) => {
    const buffer = Buffer.from(ExpoCrypto.getRandomBytes(size));
    return buffer;
  },
  createHash: () => { throw new Error('crypto.createHash is not mocked') },
  pbkdf2Sync: () => { throw new Error('crypto.pbkdf2Sync is not mocked') },
};
