import { Router } from "express";
import { NftController } from "@/controllers/nft.controller";

export const createNftRoutes = (): Router => {
  const router = Router();
  const nftController = new NftController();

  router.post("/", nftController.mintNft);

  router.get("/check/:walletAddress", nftController.checkUserNft);

  router.get("/contract-info", nftController.getContractInfo);

  router.get("/getMerkleProof", nftController.getMerkleProof);

  router.get("/owned/:walletAddress", nftController.getOwnedNfts);

  return router;
};
