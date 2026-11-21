export type ToolId='raise'|'lower'|'flatten'|'smooth'|'slope'|'noise';
export type EditorSection='tool'|'world'|'render';
export type ToolDefinition={id:ToolId;label:string;glyph:string;key:string};
export const TOOL_DEFINITIONS:ToolDefinition[]=[
 {id:'raise',label:'Raise',glyph:'＋',key:'1'},{id:'lower',label:'Lower',glyph:'−',key:'2'},
 {id:'flatten',label:'Flatten',glyph:'▰',key:'3'},{id:'smooth',label:'Smooth',glyph:'≈',key:'4'},
 {id:'slope',label:'Slope',glyph:'◢',key:'5'},{id:'noise',label:'Noise',glyph:'✳',key:'6'}
];
