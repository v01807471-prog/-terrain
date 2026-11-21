/** Compatibility bridge for the gradual React migration of legacy engine controls. */
export function clickLegacy(selector:string):void{document.querySelector<HTMLElement>(selector)?.click()}
export function setLegacyValue(id:string,value:number):void{const el=document.getElementById(id) as HTMLInputElement|null;if(!el)return;el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}))}
