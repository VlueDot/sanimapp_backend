import fetch from 'node-fetch'
import * as settings from './GlobalSetting'

export async function OdooLogin(){ 
        const response = await fetch(settings.odoo_url, settings.odoo_access);
        const data = await response.json();
        console.log(data);
        return 0;
    }

 
