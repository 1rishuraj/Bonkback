import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()
mongoose.connect(process.env.DB_URL)
const TxnSchema=new mongoose.Schema({
    signature:String,
    result:String,
    timestamp:String,
    category:String,
    user:{type:mongoose.Schema.Types.ObjectId, ref:"user"}
})
const UserSchema=new mongoose.Schema({
    name:String,
    email:String,
    password:String,
    publickey:String,
    privatekey:String
})
const User=mongoose.model('user',UserSchema);
const Txn=mongoose.model('txn',TxnSchema);

export default { User, Txn }; // Default export of an object containing both models
