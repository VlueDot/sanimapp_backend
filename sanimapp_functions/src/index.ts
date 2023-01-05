import * as functions from "firebase-functions";
import * as Odoo from "./Odoo_utils";
// import { Firebase_utils } from "./Firebase_utils";

export const TestFunction = functions.https.onRequest( (request,response) => {
  //do here whatever you must
  response.send("TestFunction Finished")
})


export const OdooSync = functions.https.onRequest(async (request, response)=> {
  //this will run with certain periodicity. This will be the stable function. 
  try{
    let odoo_login = await Odoo.OdooLogin();

    

    if (odoo_login == 1) Odoo.OdooLogout()

    response.send("OdooSync Finished Successfully")
  
  }
  catch(error)
  {
    functions.logger.error(error);

    response.send("OdooSync Error: "+error)
    
  }
  
})






