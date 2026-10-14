import {test,expect} from '@playwright/test';

async function makeProject(request){
 const result=await request.post('/api/editor/projects',{data:{title:'V43 图片评审 '+Math.random().toString(36).slice(2,8),
  paragraphs:[{text:'人工评审图片的目标是识别不准确的内容和可能影响编辑可靠性的潜在风险。'},
   {text:'需要保留每张图片的作者评价记录，同时确保从排版器导回的图片地址没有被替换。'}]
 }});
 expect(result.status()).toBe(201);const project=await result.json();
 const planned=await request.post('/api/illustrations/projects/'+project.id+'/plan',{data:{expectedMasterRevision:1}});
 expect(planned.status()).toBe(201);
 return {project,plan:await planned.json()};
}
test('V43 in-browser offline reviewer shows no evidence when no generated images exist',async({page,request})=>{
 const {project}=await makeProject(request);
 await page.goto('/illustrations?project='+project.id);
 await expect(page.getByTestId('v43-quality-workspace')).toBeVisible();
 await expect(page.getByText('还没有可评分的图片。生成图片后可以记录人工评价。')).toBeVisible();
 await page.getByRole('button',{name:'检查已导回并保存的渠道稿'}).click();
 const result=page.getByTestId('v43-roundtrip-result');
 await expect(result).toBeVisible();
 await expect(result.getByText(/图片导回存在待核对差异/)).toBeVisible();
 await expect(result.getByText(/no_imported_layout/)).toBeVisible();
 const budget=await (await request.get('/api/illustrations/projects/'+project.id+'/budget')).json();
 expect(budget.used).toBe(0);
});
test('V43 pasted doocs Markdown preview is read-only and does not alter saved layout',async({page,request})=>{
 const {project}=await makeProject(request);
 const composer='/api/composer/projects/'+project.id+'/wechat';
 const before=await (await request.get(composer)).json();
 await page.goto('/illustrations?project='+project.id);
 const box=page.getByLabel('待导回的图片Markdown');
 const preview='# 只读测试\n\n![未审核的额外图片](https://cdn.example.org/unapproved.png)';
 await box.fill(preview);
 await page.getByRole('button',{name:'校验待导回的 Markdown（只读）'}).click();
 await expect(page.getByTestId('v43-roundtrip-result').getByText(/unmapped_or_extra_image/)).toBeVisible();
 const after=await (await request.get(composer)).json();
 expect(after.layoutRevision).toBe(before.layoutRevision);
 expect(after.markdown).toBe(before.markdown);
 const budget=await (await request.get('/api/illustrations/projects/'+project.id+'/budget')).json();
 expect(budget.used).toBe(0);
});
