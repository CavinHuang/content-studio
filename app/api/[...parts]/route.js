import { dispatchApi } from '../../../lib/api.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request){return dispatchApi(request);}
export async function POST(request){return dispatchApi(request);}
export async function PUT(request){return dispatchApi(request);}
export async function PATCH(request){return dispatchApi(request);}
export async function DELETE(request){return dispatchApi(request);}
