import {Suspense} from 'react';
import DeliveryWorkspace from '../../components/DeliveryWorkspace';
export default function Page(){return <Suspense fallback={<p style={{padding:32}}>正在读取交付审核状态…</p>}><DeliveryWorkspace/></Suspense>}
