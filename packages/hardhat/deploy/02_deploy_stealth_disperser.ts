import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploys the StealthDisperser helper.
 *
 * The disperser is used by the frontend when Status Network doesn't put a
 * stealth on the gasless tier: instead of one main->stealth transfer per
 * loan (which exactly tags each stealth with the Karma holder), the UI
 * bundles every top-up into a single `batch(...)` call, with uniform amounts
 * and optional decoy recipients. Observers see a set of addresses being
 * funded together, not per-recipient intent.
 *
 * Stateless, permissionless, no constructor args — same deployment on every
 * network we target.
 */
const deployStealthDisperser: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("StealthDisperser", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
};

export default deployStealthDisperser;

deployStealthDisperser.tags = ["StealthDisperser"];
