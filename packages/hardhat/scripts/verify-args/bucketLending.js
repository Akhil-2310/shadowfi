// Constructor args for BucketLending on Status Hoodi (chain 374).
// Must exactly match what 01_deploy_bucket_lending.ts passed at deploy:
//   - karmaAddress: real Status Network Karma on Hoodi
//   - initialBuckets: [0.1 ETH, 0.5 ETH, 1 ETH] in wei
module.exports = [
  "0x0700be6f329cc48c38144f71c898b72795db6c1b",
  ["100000000000000000", "500000000000000000", "1000000000000000000"],
];
