import NextAuth from "next-auth";
import {PrismaAdapter} from "@auth/prisma-adapter";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { db } from "./lib/db";
import authConfig from "./auth.config";
import { readSessionUserRecord } from "./features/auth/lib/session-user";

type OAuthAccount = {
    type: string
    provider: string
    providerAccountId: string
    access_token?: string | null
    refresh_token?: string | null
    expires_at?: number | null
    token_type?: string | null
    scope?: string | null
    id_token?: string | null
    session_state?: string | null
}

function toPrismaAccount(account: OAuthAccount) {
    return {
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        accessToken: account.access_token,
        refreshToken: account.refresh_token,
        expiresAt:
            typeof account.expires_at === "number"
                ? Math.trunc(account.expires_at)
                : undefined,
        tokenType: account.token_type,
        scope: account.scope,
        idToken: account.id_token,
        sessionState:
            typeof account.session_state === "string"
                ? account.session_state
                : undefined,
    }
}

const baseAdapter = PrismaAdapter(db)

const adapter: Adapter = {
    ...baseAdapter,
    createUser: async (data) => {
        const user = await db.user.create({
            data: {
                name: data.name,
                email: data.email,
                image: data.image,
            },
        })
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            emailVerified: null,
        }
    },
    linkAccount: (account) =>
        baseAdapter.linkAccount!({
            ...toPrismaAccount(account),
            userId: account.userId,
        } as AdapterAccount),
}


export const {auth, handlers, signIn, signOut} = NextAuth({
    callbacks:{
    async signIn({user,account}){
    if(!user?.email||!account){
        return false;
    }
    const email = user.email;
    //check if user exists
    const exisitingUser = await db.user.findUnique({
        where:{
            email,
        },
    });
    if(!exisitingUser){
        const newUser=await db.user.create({
            data:{
                email,
                name:user.name,
                image:user.image,
                accounts:{
                    create: toPrismaAccount(account),
                },
            },
        });
        if(!newUser){
            return false;
        }
        return true;
    }
    else{
        const existingAccount=await db.account.findUnique({
            where:{
                provider_providerAccountId:{
                    provider:account.provider,
                    providerAccountId:account.providerAccountId,
                },
            },
        });
        if(!existingAccount){
            const newAccount=await db.account.create({
                data:{
                    userId:exisitingUser.id,
                    ...toPrismaAccount(account),
                },
            });
            if(!newAccount){
                return false;
            }
            return true;
        }
        return true;
    }
},
    async jwt({token,user,account}){
        if(!token.sub) return token;

        const exisitingUser=await readSessionUserRecord(token.sub);

        if(!exisitingUser){
            return token;
        }

        token.name=exisitingUser.name;
        token.email=exisitingUser.email;
        token.role=exisitingUser.role;

        return token;
},
    async session({session,token}){
        if(token.sub && session.user){
            session.user.id=token.sub;
        }
        if(token.sub && session.user){
            session.user.role=token.role;
        }
        return session;
    }
} ,
    adapter,
    session:{
        strategy:'jwt',
    },
    ...authConfig
});
