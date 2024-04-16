
import * as fcn from "firebase-functions";
const nodemailer = require("nodemailer");

const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
const secretClient = new SecretManagerServiceClient();


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

let transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "alfa.vluedot@gmail.com",
    pass: "orvzeswbmdpdclft",
  },
});

export async function sendEmail(subject_str: string, welcome_str:string, dateTs:any, message_str: string, items_container:any) {
  let date_str;
  if (dateTs != false) {
    const date = new Date(Number(dateTs));
    date_str = date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2);
  } else {
    date_str = "";
  }
  let environ:string;
  if (process.env.GCLOUD_PROJECT === "sanimapp-prod") environ = "[PROD]";
  else environ = "[DEV]";
  const mailOptions = {
    from: "Sanimapp Backend Assistant",
    // to: ["alfa.vluedot@gmail.com"],
    to: ["alfa.vluedot@gmail.com",
      "pablo.centeno@sanima.pe",
      "milagros.arcos@sanima.pe",
      "shirley.abanto@sanima.pe",
      "gabriela.castro@sanima.pe",
    ],
    subject: environ + subject_str,
    html: `
          <p>Hola equipo de Sanima! <br>
          ${welcome_str} ${date_str} :<br>
          
          ${message_str} : <br>

              <ol type="1">
                ${items_container.map( (entry:any) => `<li>${entry}</li>`).join("")}
              </ol>
              
          
              <br>
              Atentamente, <br>
              Equipo de Vluedot.
          </p>`,
  };


  return transporter.sendMail(mailOptions, (error:any) => {
    if (error) {
      console.log(error);
      return;
    }
    fcn.logger.info(environ + subject_str +": Email sent! ");
  });
}

// ---------------------------------------------------------------- test mail

// let transporter2 = nodemailer.createTransport({
//   host: "smtp.gmail.com",
//   port: 465,
//   secure: true,
//   auth: {
//     user: "alfa.vluedot@gmail.com",
//     pass: "orvzeswbmdpdclft",
//   },
// });

export async function sendEmail2(subject_str: string, welcome_str:string, dateTs:any, message_str: string, items_container:any) {
  console.log("1")
  const name  = 'Test1Mail'
  const request = {
    name,
  };
  const accessResponse = await secretClient.getSecret(request)
  console.log(accessResponse);
  console.log("2")

  const responsePayload = accessResponse.payload.data.toString('utf8');
  console.info(`Payload: ${responsePayload}`);

  /*

  let date_str;
  if (dateTs != false) {
    const date = new Date(Number(dateTs));
    date_str = date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2);
  } else {
    date_str = "";
  }
  let environ:string;
  if (process.env.GCLOUD_PROJECT === "sanimapp-prod") environ = "[PROD]";
  else environ = "[DEV]";
  const mailOptions = {
    from: "Sanimapp Backend Assistant",
    // to: ["alfa.vluedot@gmail.com"],
    to: ["alfa.vluedot@gmail.com",

    ],
    subject: environ + subject_str,
    html: `
          <p>Hola equipo de Sanima! <br>
          ${welcome_str} ${date_str} :<br>

          ${message_str} : <br>

              <ol type="1">
                ${items_container.map( (entry:any) => `<li>${entry}</li>`).join("")}
              </ol>


              <br>
              Atentamente, <br>
              Equipo de Vluedot.
          </p>`,
  };

  return transporter2.sendMail(mailOptions, (error:any) => {
    if (error) {
      console.log(error);
      return;
    }
    fcn.logger.info(environ + subject_str +": Email sent! ");
  });
*/
 return true
}
