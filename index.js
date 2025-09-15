import express from "express";
import models from "./db.js"; // Import the default export from db.js
import { Keypair, Connection, Transaction, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import zod from "zod";
import cors from "cors";
import bs58 from "bs58";

const app = express();
const { User, Txn } = models; // Destructure to get User and Txn

const allowedOrigins = [
  "http://localhost:5173",
  
];

// Use CORS middleware
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Allow non-browser clients like Postman
      const normalizedOrigin = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(express.json());
const signup = zod.object({
  name: zod.string(),
  email: zod.email(),
  password: zod.string(),
});
app.post("/signup", async function (req, res) {
  const data = req.body;
  const response = signup.safeParse(data);
  if (!response.success) {
    res.send(response.data);
  } else {
    const { name, email, password } = req.body;
    //check if user already exist
    const uid = await User.findOne({
      email: email,
    });
    if (uid) {
      res.send("Email already exists.");
    } else {
      const keypair = Keypair.generate();
      const publickey = keypair.publicKey.toBase58();
      const privatekey = bs58.encode(keypair.secretKey);
      const hashed = await bcrypt.hash(password, 10);
      await User.create({
        name,
        email,
        password: hashed,
        publickey,
        privatekey,
      });

      res.send({
        publickey: publickey,
      });
    }
  }
});
const signin = zod.object({
  email: zod.email(),
  password: zod.string(),
});
app.post("/signin", async function (req, res) {
  const data = req.body;
  const response = signin.safeParse(data);
  if (!response.success) {
    res.send(response);
  } else {
    const { email, password } = req.body;
    //check: does user exist
    const uid = await User.findOne({
      email: email,
    });
    if (!uid) {
      res.send("Signup first. Email doesn't exist.");
    } else {
      const isvalid = await bcrypt.compare(password, uid.password);
      if (!isvalid) {
        res.send("Incorrect password");
      } else {
        const sign = jwt.sign({ id: uid }, process.env.JWT_SECRET);
        res.send({
          token: sign,
          publickey: uid.publickey,
        });
      }
    }
  }
});

app.use(function (req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("No authorization header");
  }
  const token = authHeader.split(" ")[1];
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.id = verified.id;
    next();
  } catch (err) {
    return res.status(401).send("Invalid token");
  }
});
const buy = zod.object({
  message: zod.string(),
});
app.get("/", function (req, res) {
  res.status(200).send({ pvtkey: req.id.privatekey });
});
app.get("/txn", async function (req, res) {
  try {
    // fetch all transactions of the user
    let arr = await Txn.find({ user: req.id._id });

    // process only pending txns
    const pendingTxns = arr.filter(txn => txn.result === "pending");

    if (pendingTxns.length > 0) {
      let config = {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      };

      // update each pending txn
      await Promise.all(
        pendingTxns.map(async (txn) => {
          try {
            const isValid = await connection.getTransaction(txn.signature, config);

            if (isValid) {
              const result = isValid.meta?.err === null ? "success" : "failed";

              await Txn.findByIdAndUpdate(txn._id, {
                result,
              });
            }
          } catch (err) {
            console.error("Error checking txn:", txn.signature, err.message);
          }
        })
      );

      // re-fetch with updated status
      arr = await Txn.find({ user: req.id._id });
    }

    res.json({ arr });
  } catch (err) {
    console.error("Error in /txn:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
app.post("/api/v1/txn/buy", async function (req, res) {
  const data = req.body;
  const response = buy.safeParse(data);
  if (!response.success) {
    res.send(response);
  } else {
    // const serialised = req.body.message;
    // const tx = Transaction.from(Buffer.from(serialised,"base64"));
    // const payer = Keypair.fromSecretKey(bs58.decode(req.id.privatekey));
    const payer = Keypair.fromSecretKey(bs58.decode(req.id.privatekey));
    console.log(payer.publicKey.toBase58());
    try {
      const { message } = req.body;
      const txBuffer = Buffer.from(message, "base64");

      // Deserialize transaction
      const tx = Transaction.from(txBuffer);

      // Optional: Verify transaction contents before signing
      // e.g., check first instruction is a Raydium swap

      // Sign with custodial wallet
      tx.sign(payer);

      // Send to Solana
      const txSig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      // const signature = txSig;

      // const signature = "5YPTP2MVeRAPmhfsNPsXUWkJ5tK3oPmh9c2mnPhy2j2hPr4NVJCE84hjuqEAo5mxiF9ayHyfTRUUvAAyWJUsHUJc";
      // const signature="Wyd5TvgBzKzSzM6NeqojaUPAWrKZFzQtjA5EgV9Hyv3adEEozqTaHxf3aRS7b6fCYNxzNzwGve2zNVriSSo9y8P"
      // await connection.confirmTransaction(
      //   { signature: txSig, commitment: "finalized" },
      //   "finalized"
      // );

      //  const txSig="2MgXpBAKrVyCoNWVhAjhvoLnBXPKpKbmXxGTCsm3yB3Zq3cknUyiEVEcWXNVLyhk8aLGHGjLo75wyCNKNeN3DwM3"
      console.log(txSig);
      await Txn.create({
        signature: txSig,
        result: "pending", // mark as pending initially
        timestamp: new Date().toLocaleString(),
        category: "BUY",
        user: req.id._id,
      });

      res.json({ txSig });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
    // res.send("buy se");
  }
});

app.post("/api/v1/txn/sell", async function (req, res) {
  const data = req.body;
  const response = buy.safeParse(data);
  if (!response.success) {
    res.send(response);
  } else {
    // const serialised = req.body.message;
    // const tx = Transaction.from(Buffer.from(serialised,"base64"));
    // const payer = Keypair.fromSecretKey(bs58.decode(req.id.privatekey));
    const payer = Keypair.fromSecretKey(bs58.decode(req.id.privatekey));
    console.log(payer.publicKey.toBase58());
    try {
      const { message } = req.body;
      const txBuffer = Buffer.from(message, "base64");

      // Deserialize transaction
      const tx = Transaction.from(txBuffer);

      // Optional: Verify transaction contents before signing
      // e.g., check first instruction is a Raydium swap

      // Sign with custodial wallet
      tx.sign(payer);

      // Send to Solana
      const txSig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      //  const txSig="2MgXpBAKrVyCoNWVhAjhvoLnBXPKpKbmXxGTCsm3yB3Zq3cknUyiEVEcWXNVLyhk8aLGHGjLo75wyCNKNeN3DwM3"
      // await connection.confirmTransaction(
      //   { signature: txSig, commitment: "finalized" },
      //   "finalized"
      // );
      // let config = {
      //   commitment: "finalized",
      //   maxSupportedTransactionVersion: 0,
      // };
      // // const signature = "5YPTP2MVeRAPmhfsNPsXUWkJ5tK3oPmh9c2mnPhy2j2hPr4NVJCE84hjuqEAo5mxiF9ayHyfTRUUvAAyWJUsHUJc";
      // // const signature="Wyd5TvgBzKzSzM6NeqojaUPAWrKZFzQtjA5EgV9Hyv3adEEozqTaHxf3aRS7b6fCYNxzNzwGve2zNVriSSo9y8P"
      // const isValid = await connection.getTransaction(txSig, config);

      // if (isValid) {
      //   const result = isValid.meta?.err === null ? "success" : "failed";
      //   const timestamp = isValid.blockTime
      //     ? new Date(isValid.blockTime * 1000).toLocaleString()
      //     : "N/A";
      console.log(txSig)
      await Txn.create({
        signature: txSig,
        result: "pending", // mark as pending initially
        timestamp: new Date().toLocaleString(),
        category: "SELL",
        user: req.id._id,
      });

      res.json({ txSig });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
    // res.send("sell se");
  }
});
app.listen(3000);
