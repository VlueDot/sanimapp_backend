import fetch from 'node-fetch'
import * as settings from './GlobalSetting'

export async function OdooLogin(){ 
    const response = await fetch(settings.odoo_url + "session/authenticate", settings.odoo_access);
    const data = await response.json()
    console.log(data);
    
    return response.status
         
    }

export async function OdooLogout(){ 
    const response = await fetch(settings.odoo_url + "logout");
    return await response.statusText;
            
    }

 
