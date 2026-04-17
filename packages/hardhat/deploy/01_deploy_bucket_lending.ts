import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract, parseEther } from "ethers";

/**
 * Deploys the privacy-first lending stack.
 *
 * On Status Network Hoodi (chain 374): points at the real Karma contract
 *   (0x0700be6f329cc48c38144f71c898b72795db6c1b). No MockKarma is deployed.
 *
 * On local hardhat / localhost: deploys a MockKarma stub (balanceOf only) and
 *   seeds the deployer with 20 Karma so the full flow is demo-able end-to-end.
 */
const KARMA_ADDRESSES: Record<string, string> = {
  statusHoodi: "0x0700be6f329cc48c38144f71c898b72795db6c1b",
};

const deployBucketLending: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const net = hre.network.name;

  let karmaAddress = KARMA_ADDRESSES[net];

  const isLocal = net === "hardhat" || net === "localhost";
  if (!karmaAddress) {
    if (!isLocal) {
      throw new Error(
        `No Karma address configured for network "${net}". Add one to KARMA_ADDRESSES in the deploy script or deploy to statusHoodi.`,
      );
    }
    const karmaDeployment = await deploy("Karma", {
      contract: "MockKarma",
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    karmaAddress = karmaDeployment.address;
  }

  const buckets = [parseEther("0.1"), parseEther("0.5"), parseEther("1")];

  await deploy("BucketLending", {
    from: deployer,
    args: [karmaAddress, buckets],
    log: true,
    autoMine: true,
  });

  if (isLocal) {
    const karma = await hre.ethers.getContract<Contract>("Karma", deployer);
    const existing: bigint = await karma.balanceOf(deployer);
    const target = parseEther("20");
    if (existing < target) {
      const tx = await karma.award(deployer, target - existing);
      await tx.wait();
      console.log(`✨ Seeded deployer with ${target - existing} Karma (test only)`);
    }
  } else {
    console.log(`🔗 Using real Karma at ${karmaAddress} on ${net}`);
  }
};

export default deployBucketLending;

deployBucketLending.tags = ["BucketLending", "Karma"];
