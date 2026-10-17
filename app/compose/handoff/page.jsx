import {Suspense} from 'react';
import WeChatComposer from '../../../components/WeChatComposer';
export default function Page(){return <Suspense fallback={<p>正在载入历史排版交接…</p>}><WeChatComposer/></Suspense>}
