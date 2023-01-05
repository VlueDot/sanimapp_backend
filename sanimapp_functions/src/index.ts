import * as functions from "firebase-functions";
import * as Odoo from "./Odoo_utils";
// import { Firebase_utils } from "./Firebase_utils";



export const OdooSync = functions.https.onRequest(async (request, response)=> {
  try{
    let odoo_login = await Odoo.OdooLogin();

    if(odoo_login[0] == "OK") functions.logger.info(odoo_login[1]);
    else if(odoo_login[0] == "ERROR") functions.logger.info(odoo_login[1]);
    else functions.logger.error("OdooLogin Error: unexpected")

  }
  catch(error)
  {
    functions.logger.error("OdooLogin Error: " + error);
    
  }

  try {
    let odoo_logout = await Odoo.OdooLogout()
    if(odoo_logout==200) functions.logger.info("Odoo Logout: " + odoo_logout);
    else functions.logger.error("Odoo Logout: " + odoo_logout);
    
  } catch (error) {
    functions.logger.error("OdooLogout Error: " + error);
  }

  
  
  
  response.send("OdooSync")
  
})




