import {Suspense} from 'react';
import './writing.css';
import './compose-v2.css';
import WritingWorkspace from '../../components/WritingWorkspace';
export default function Page(){return <Suspense fallback={<p style={{padding:32}}>正在打开创作工作台…</p>}><WritingWorkspace/></Suspense>}
