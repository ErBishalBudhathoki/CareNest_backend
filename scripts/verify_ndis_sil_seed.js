/* eslint-disable no-console */
const path=require('path');const {MongoClient}=require('mongodb');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
(async()=>{const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db(process.env.DB_NAME||'Invoice');
const orgId=process.argv[2]||'699980eb8fd21a3864b1aade';
const n=(x)=>db.collection(x).countDocuments({organizationId:orgId});
console.log('org',orgId);
for(const col of ['clients','silProperties','silOccupancies','silRatioRules','silQuotes','silRostersOfCare','invoices','claimBatches','claimLines'])
  console.log(' ',col.padEnd(18), await n(col));
const rocs=await db.collection('silRostersOfCare').find({organizationId:orgId,status:{$in:['active','under_review']}}).toArray();
console.log('\nActive RoCs:');
for(const r of rocs){const cl=await db.collection('clients').findOne({_id:r.clientId});console.log(' ',r._id,'|',cl?.clientEmail,'| funding=',cl?.fundingType,'| ndis=',cl?.ndisNumber,'| supports=',(r.supports||[]).length);}
const inv=await db.collection('invoices').find({organizationId:orgId,'metadata.generationMethod':'sil_roster_of_care'}).toArray();
console.log('\nSIL invoices:');
for(const i of inv)console.log(' ',i.invoiceNumber,'|',i.clientEmail,'| $'+i.financialSummary?.totalAmount,'| billing=',JSON.stringify(i.billing));
await c.close();})();
