import {test,expect} from '@playwright/test';

test('V50 composer explains reachability is not verified publishing and can explicitly retry',async({page})=>{
 let probes=0;
 await page.route('**/api/integrations/doocs/preflight',async route=>{
  probes++;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   kind:'content-studio-v50-doocs-local-preflight',status:probes===1?'unavailable':'reachable',
   reason:probes===1?'connection_failed_or_timed_out':undefined,
   articleBytesSent:0,platformVerified:false,editorIdentityVerified:false,
   markdownRoundtripVerified:false,published:false,paidRequests:0
  })});
 });
 await page.goto('/compose/handoff');
 const status=page.getByTestId('v50-doocs-status');
 await expect(status).toContainText('尚未连接本机排版器');
 await status.getByRole('button',{name:'重新检查连接'}).click();
 await expect(status).toContainText('本机排版器服务可连接');
 await expect(status).toContainText('未核实 doocs 身份或实际排版效果');
 expect(probes).toBeGreaterThanOrEqual(2);
});
