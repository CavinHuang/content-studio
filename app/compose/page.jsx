import {Suspense} from 'react';
import WeChatComposer from '../../components/WeChatComposer';
export default function Page(){return <Suspense fallback={<p style={{padding:32}}>正在打开排版工作台…</p>}><WeChatComposer/></Suspense>}
