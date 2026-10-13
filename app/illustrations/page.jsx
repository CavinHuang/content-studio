import {Suspense} from 'react';
import IllustrationStudio from '../../components/IllustrationStudio';
export default function Page(){return <Suspense fallback={<p style={{padding:32}}>正在打开 Agent 配图工作台…</p>}><IllustrationStudio/></Suspense>}
