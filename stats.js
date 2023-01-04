//Calculate Stats Tutorial Here video: https://www.youtube.com/watch?v=gATX0yYMFYA
//This project dashboard is an iteration of the above
//To run this page cd stats > node stats.js

const Moralis = require("moralis").default;
// const Moralis = require("moralis-v1/node");
const fs = require("fs");
var mongoose = require("mongoose");
const ownersModel = require("../models/owners.model");
const historyModel = require("../models/history.model");
const { EvmChain } = require('@moralisweb3/common-evm-utils');
// const startServer  = require("../server/index");
require('dotenv').config()

const OwnersD = require('../../moonbirdsOwners.json');
const History = require('../../moonbirdsHistory.json');

const Chain = EvmChain.ETHEREUM;

const serverUrl = process.env.serverUrl;

const apikey = process.env.apiKey;
//Contract address we are pulling the stats from
const contractAddress = "0x23581767a106ae21c074b2276d25e5c3e136a68b"; //Moonbirds

//Filter out nonunique prices. Like bulk orders.
Array.prototype.getUnique = function () {
  var uniques = [];
  for (var i = 0, l = this.length; i < l; ++i) {
    if (this.lastIndexOf(this[i]) == this.indexOf(this[i])) {
      uniques.push(this[i]);
    }
  }
  return uniques;
};

// 1e18 finds the price in Ethereum, converts it from GWEI
const averagePrice = (array) => {
  const filteredZero = array.filter((item) => item !== 0);
  const filtered = filteredZero.getUnique();

  if (filtered.length > 1) {
    return (
      filtered.reduce((a, b) => Number(a) + Number(b)) / filtered.length / 1e18
    );
  } else if (filtered.length === 1) {
    return filtered[0] / 1e18;
  } else {
    return 0;
  }
};

//Find out the avg amount of days since purchased. Combine if there are multiple entries and divide by total entries.
const averageDaySinceBuy = (array) => {
  let ms;
  if (array.length > 1) {
    ms =
      array.reduce((a, b) => new Date(a).getTime() + new Date(b).getTime()) /
      array.length;
  } else {
    ms = new Date(array[0]).getTime();
  }
  const diff = Math.floor((new Date().getTime() - ms) / 86400000);

  return diff;
};

async function getAllOwners() {
  try {
   await Moralis.start({ 
    apiKey: apikey,
  });
  
    let cursor = null;
    let owners = {};
    let history = {};
    let res;
    let accountedTokens = [];
  
    //Intialize date that's 30 days prior
    let date = new Date();
  
    date.setDate(date.getDate() - 30);
  
    //To push into Moralis API
    const blockoptions = {
      chain: Chain,
      date: date,
    };
    const block = await Moralis.EvmApi.block.getDateToBlock(blockoptions)
    // const block = await Moralis.Web3API.native.getDateToBlock(blockoptions);
  
    const monthBlock = Number(block.block);
  
    // cursor is automatically set to only get 100 responses, we need to set cursor so that we can loop and get more responses.
    do {
      const response = await Moralis.EvmApi.nft.getNFTContractTransfers({
        address: contractAddress,
        chain: Chain,
        limit: 100,
        cursor: cursor,
      });
    const resp = await Moralis.EvmApi.nft.getContractNFTs({
        address: contractAddress,
        chain: Chain,
        limit: 100,
        cursor: cursor,
      })
      console.log('resp: ',resp)
      res = response.toJSON();
      console.log(
        `Got page ${res.page} of ${Math.ceil(
          res.total / res.page_size
        )}, ${res.total} total`
      );
      //blockchain data response processing
      for (const transfer of res.result) {
        //check if transactions happened within 30 days
        let recentTx = 0;
        if (monthBlock < Number(transfer.block_number)) {
          recentTx = 1;
        }
  
        if (
          !owners[transfer.to_address] &&
          !accountedTokens.includes(transfer.token_id)
        ) {
          //initialize owner if not already initialized
          owners[transfer.to_address] = {
            address: transfer.to_address,
            amount: Number(transfer.amount),
            tokenId: [transfer.token_id],
            prices: [Number(transfer.value)],
            dates: [transfer.block_timestamp],
            recentTx: recentTx,
            avgHold: averageDaySinceBuy([transfer.block_timestamp]),
            avgPrice: Number(transfer.value) / 1e18,
          };
          //pushes id to accountedTokens array so that we don't need to repeat this process for specific owner again
          accountedTokens.push(transfer.token_id);
        } else if (!accountedTokens.includes(transfer.token_id)) {
          //if owner is present push details instead
          owners[transfer.to_address].amount++;
          owners[transfer.to_address].tokenId.push(transfer.token_id);
          owners[transfer.to_address].prices.push(Number(transfer.value));
          owners[transfer.to_address].dates.push(transfer.block_timestamp);
          owners[transfer.to_address].recentTx = owners[transfer.to_address].recentTx + recentTx;
          owners[transfer.to_address].avgHold = averageDaySinceBuy(owners[transfer.to_address].dates);
          owners[transfer.to_address].avgPrice = averagePrice(owners[transfer.to_address].prices);
  
          //push responses to the accountedTokens array
          accountedTokens.push(transfer.token_id);
        }
        //if owner is offloading NFTs, here's the logic
        if(owners[transfer.from_address] && recentTx === 1){
          owners[transfer.from_address].recentTx = owners[transfer.from_address].recentTx - recentTx;
      } else if (!owners[transfer.from_address] && recentTx === 1){
          owners[transfer.from_address] = {
          address: transfer.from_address,
          amount: 0,
          tokenId: [],
          prices: [],
          dates: [],
          recentTx: -recentTx,
          avgHold: 0,
          avgPrice: 0,
          };
      }
        //Find all transactions from a specific user pertaining/limited to a specific collection. 
        //This if/else is pertaining to transaction "to" a given wallet.
        if(!history[transfer.to_address]){
            history[transfer.to_address] = [{
                to: transfer.to_address,
                from: transfer.from_address,
                price: transfer.value,
                date: transfer.block_timestamp,
                tokenId: transfer.token_id,
            },
          ]
        }else{
            history[transfer.to_address].push({
                to: transfer.to_address,
                from: transfer.from_address,
                price: transfer.value,
                date: transfer.block_timestamp,
                tokenId: transfer.token_id,
            });
        }
        //Same thing as above but for transfers "from" a given wallet.
        if(!history[transfer.from_address]){
          history[transfer.from_address] = [{
              to: transfer.to_address,
              from: transfer.from_address,
              price: transfer.value,
              date: transfer.block_timestamp,
              tokenId: transfer.token_id,
          },
        ]
      }else{
          history[transfer.from_address].push({
              to: transfer.from_address,
              from: transfer.from_address,
              price: transfer.value,
              date: transfer.block_timestamp,
              tokenId: transfer.token_id,
          });
      }
  
      }
  
      cursor = res.cursor;
    } while (cursor != "" && cursor != null);
  
    const jsonContentOwners = JSON.stringify(owners);
    const jsonContentHistory = JSON.stringify(history);
    
    
    try {
      await mongoose.connect(
        (uri ='mongodb://127.0.0.1:27017/DataDegen'),
        {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        }
      );
      console.log("Database connected");
    } catch (error) {
      console.log("error: ",error);
    }
  
    //Write JSON files saving the content 
    //Owner data
    fs.writeFile(
      "moonbirdsOwners.json",
      jsonContentOwners,
      "utf8",
      async function (err) {
        if (err) {
          console.log(
            "An error occured while writing JSON Object to file. location: stats.js"
          );
          return console.log(err);
        }
        console.log("JSON file has been saved.");
        const owners_data = await ownersModel.find({});
        if(owners_data.length > 0){
          await ownersModel.deleteMany({});
          Object.keys(OwnersD).forEach(async(key) => {
            const addData = new ownersModel({
              walletAddress: contractAddress,
              address: OwnersD[key].address,
              amount: OwnersD[key].amount,
              tokenId: OwnersD[key].tokenId,
              prices: OwnersD[key].prices,
              dates: OwnersD[key].dates,
              recentTx: OwnersD[key].recentTx,
              avgHold: OwnersD[key].avgHold,
              avgPrice: OwnersD[key].avgPrice,
            })
            await addData.save();
          })
          console.log("Owners Data save successfully!")
        }else{
          Object.keys(OwnersD).forEach(async(key) => {
            const addData = new ownersModel({
              walletAddress: contractAddress,
              address: OwnersD[key].address,
              amount: OwnersD[key].amount,
              tokenId: OwnersD[key].tokenId,
              prices: OwnersD[key].prices,
              dates: OwnersD[key].dates,
              recentTx: OwnersD[key].recentTx,
              avgHold: OwnersD[key].avgHold,
              avgPrice: OwnersD[key].avgPrice,
            })
            await addData.save();
          })
          console.log("Owners Data save successfully!")
        }
        
      }
    );
  
    //History of transactions
    fs.writeFile(
      "moonbirdsHistory.json",
      jsonContentHistory,
      "utf8",
      async function (err) {
        if (err) {
          console.log(
            "An error occured while writing JSON Object to file. location: stats.js"
          );
          return console.log(err);
        }
        console.log("JSON file has been saved.");
        const history_data = await historyModel.find({});
        if(history_data.length > 0){
          await historyModel.deleteMany({});

          Object.keys(History).forEach(async(key) => {
            const addData = new historyModel({
              addressId: key,
              metaData: History[key]
            })
            await addData.save();
          })
          console.log("history Data save successfully!")
        }else{
          Object.keys(History).forEach(async(key) => {
            const addData = new historyModel({
              addressId: key,
              metaData: History[key]
            })
            await addData.save();
          })
          console.log("history Data save successfully!")
        }
        // startServer();
      }
    );
  } catch (error) {
    console.log("Error Is => ", error)
  }
 

}

getAllOwners();
// saveMongo();

setInterval(getAllOwners, 86400000); // <- Restart ever 24 hours