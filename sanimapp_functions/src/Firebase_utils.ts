
import * as fcn from "firebase-functions";
const nodemailer = require('nodemailer')



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

export async function firebaseUpdate(ref: string, data:any) {
  try {
    const messageRef = admin.database().ref(ref);
    await messageRef.update(data);
    return true;
  } catch (error) {
    return false;
  }
}

export async function firebasePush(ref: string, data:any) {
  try {
    const messageRef = admin.database().ref(ref);
    await messageRef.push(data);
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

var transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
      user: "alfa.vluedot@gmail.com",
      pass: "orvzeswbmdpdclft"
  }
});

export async function sendEmail(dateTs:any, container:any) {
  const date = new Date(Number(dateTs));
  const date_str =  date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2)
  let env
  if(process.env.GCLOUD_PROJECT === "sanimapp-prod") env = "[PROD]"
  else env = "[DEV]"
  const mailOptions = {
    from: "Sanimapp Backend Assistant",
    to: ["rvin.rdgz@gmail.com"],
    subject: env + ' Sanimapp Backend Alert',
    html: `
          <p>Hola equipo de Sanima! <br>
          esta alerta fue generada el ${date_str} :<br>
          
              <ol type="1">
                ${container.map( (entry:any) => `<li>${entry}</li>`).join("")}
              </ol>
              
          
              <br>
              Atentamente, <br>
              Vluedot.
          </p>`
};


  return transporter.sendMail(mailOptions, (error:any, data:any) => {
      if (error) {
          console.log(error)
          return
      }
      console.log("Sent!")
  });
  
}

        
  