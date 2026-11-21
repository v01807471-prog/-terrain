/** GPU/terrain quality presets. Values are tuned as conservative starting points. */
export const QUALITY_PRESETS={
 low:{cell:.5,area:256,grid:64,dist:1500,tex:128,aniso:1,scale:.75,detailSize:1.5,detailStr:.5,filter:"smooth"},
 medium:{cell:.25,area:256,grid:96,dist:4000,tex:256,aniso:4,scale:1,detailSize:1.5,detailStr:.55,filter:"smooth"},
 high:{cell:.25,area:256,grid:128,dist:6000,tex:256,aniso:16,scale:1.6,detailSize:1.5,detailStr:.55,filter:"smooth"},
 ultra:{cell:.25,area:256,grid:256,dist:8000,tex:512,aniso:16,scale:1.6,detailSize:1.5,detailStr:.55,filter:"smooth"}
};
