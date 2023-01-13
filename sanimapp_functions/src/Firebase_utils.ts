
import * as functions from "firebase-functions";


export async function updateCRM_Odoo(change: functions.Change<functions.database.DataSnapshot>){

    console.log(change.before.val());
    console.log(change.after.val());
    change.after.ref.set("Meow");


    let succeeded = false;
    if(succeeded) return "Success";
    else return "Error";

}


import * as admin from "firebase-admin";

export async function firebase_set(ref: string, data:any) {
    try{
        const messageRef = admin.database().ref(ref);
        await messageRef.set(data);
        return true
    }
    catch(error){
        return error
    }

  }
