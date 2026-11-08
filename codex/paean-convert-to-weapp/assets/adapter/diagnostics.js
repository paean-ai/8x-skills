// Local verification only. No dispatch, game-state mutation or external transport.
export function startDiagnostics(wx, env) {
  const path = wx.env.USER_DATA_PATH + '/adapter-verification.json';
  const records = []; let previous = '';
  const record = () => {
    const game = env.window.__game;
    const state = {time:Date.now(),source:env.sourceId,visibility:env.document.visibilityState,audio:env.audioContexts.map(a=>({state:a.state,time:a.currentTime})),frames:env.inspect().frames,errors:env.inspect().errors,touch:env.lastTouch,stats:env.stats,game:env.inspect().game};
    if(game?.player) state.player={pos:{...game.player.pos},yaw:game.player.yaw,state:game.player.state};
    if(game?.input) state.input={keys:{...game.input().keys},stick:{...game.input().stick},held:[...game.input().held]};
    if(game?.state)state.originalState=game.state;
    if(game?.G)state.progress={view:game.G.profile?.view,money:game.G.eco?.money,quills:game.G.eco?.totalQuills};
    const touch=JSON.stringify(env.lastTouch); if(touch!==previous){previous=touch;records.push(state);if(records.length>60)records.shift();}
    wx.getFileSystemManager().writeFileSync(path,JSON.stringify({latest:state,inputs:records}),'utf8');
  };
  setInterval(record,1000);console.log('[adapter diagnostics]',path);
}
