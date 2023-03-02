
import * as fcn from "firebase-functions";
// any --> functions.Change<functions.database.DataSnapshot>


export async function updateCRMOdoo(chg:fcn.Change<fcn.database.DataSnapshot>) {
  console.log(chg.before.val());
  console.log(chg.after.val());
  chg.after.ref.set("Meow");


  const succeeded = false;
  if (succeeded) return "Success";
  else return "Error";
}


import * as admin from "firebase-admin";

export async function firebaseSet(ref: string, data:any) {
  try {
    const messageRef = admin.database().ref(ref);
    await messageRef.set(data);
    return true;
  } catch (error) {
    return error;
  }
}

export async function firebaseGet(ref: string) {
  try {
    return await (await admin.database().ref(ref).get()).val();
  } catch (error) {
    return error;
  }
}


export async function firebaseRemove(ref: string) {
  try {
    const messageRef = admin.database().ref(ref);
    await messageRef.remove();
    return true;
  } catch (error) {
    return error;
  }
}
