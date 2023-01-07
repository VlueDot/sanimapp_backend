// import * as functions from "firebase-functions";
import * as admin from "firebase-admin"

// const url_timestamps = "/timestamp_collection"


const serviceAccount = require('../service-account.json')
const url_database = 'https://${serviceAccount.project_id}.firebaseio.com'
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: url_database
})


// export class Firebase_utils {
//     connectFirebase(){}

//     readFirebase(){

//     }

//     writeFirebase(){

//     }

//     getTimestampFirebase(){

//     }
// }

// export const getTimestampsFirebase = functions.database.ref(url_database + url_timestamps).subscribe((data)=>{})